"""
Async email sending utility backed by Python's smtplib (no extra dependency).
All blocking SMTP calls run in a thread executor to stay non-blocking.
"""
import asyncio
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

# In-memory cache populated from DB at startup / when settings are saved
_smtp_cfg: dict = {}


def cache_smtp_config(cfg: dict) -> None:
    global _smtp_cfg
    _smtp_cfg = cfg


def _send_sync(
    host: str,
    port: int,
    username: str,
    password: str,
    from_email: str,
    from_name: str,
    use_tls: bool,
    use_ssl: bool,
    to_email: str,
    subject: str,
    body_html: str,
    body_text: str,
) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{from_email}>" if from_name else from_email
    msg["To"] = to_email
    msg.attach(MIMEText(body_text, "plain"))
    msg.attach(MIMEText(body_html, "html"))

    if use_ssl:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=context) as smtp:
            if username:
                smtp.login(username, password)
            smtp.sendmail(from_email, to_email, msg.as_string())
    else:
        with smtplib.SMTP(host, port) as smtp:
            smtp.ehlo()
            if use_tls:
                smtp.starttls(context=ssl.create_default_context())
                smtp.ehlo()
            if username:
                smtp.login(username, password)
            smtp.sendmail(from_email, to_email, msg.as_string())


async def send_email(
    to_email: str,
    subject: str,
    body_html: str,
    body_text: str = "",
    cfg: dict | None = None,
) -> None:
    """Send an email using the cached SMTP config (or an override dict)."""
    c = cfg if cfg is not None else _smtp_cfg
    if not c.get("enabled") or not c.get("host") or not c.get("from_email"):
        raise RuntimeError("SMTP not configured or disabled")
    if not body_text:
        # Simple HTML-to-text fallback
        import re
        body_text = re.sub(r"<[^>]+>", "", body_html)

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        _send_sync,
        c["host"],
        int(c.get("port", 587)),
        c.get("username", ""),
        c.get("password", ""),
        c["from_email"],
        c.get("from_name", "VPN Dashboard"),
        bool(c.get("use_tls", True)),
        bool(c.get("use_ssl", False)),
        to_email,
        subject,
        body_html,
        body_text,
    )


async def send_test_email(to_email: str, cfg: dict) -> None:
    """Send a test email using the provided config dict."""
    await send_email(
        to_email=to_email,
        subject="[VPN Dashboard] SMTP test",
        body_html=(
            "<h2>SMTP configuration test</h2>"
            "<p>If you received this, your SMTP settings are working correctly.</p>"
            "<p><em>VPN Dashboard</em></p>"
        ),
        cfg=cfg,
    )


async def send_vpn_credentials(
    to_email: str,
    username: str,
    password: str,
    server_host: str,
) -> None:
    """Send VPN credentials to a newly-created user."""
    await send_email(
        to_email=to_email,
        subject="[VPN Dashboard] Your VPN account details",
        body_html=f"""
<h2>Your VPN account has been created</h2>
<table cellpadding="6" style="border-collapse:collapse;font-family:monospace">
  <tr><td><strong>Server</strong></td><td>{server_host}</td></tr>
  <tr><td><strong>Username</strong></td><td>{username}</td></tr>
  <tr><td><strong>Password</strong></td><td>{password}</td></tr>
  <tr><td><strong>Protocol</strong></td><td>Cisco AnyConnect / OpenConnect</td></tr>
</table>
<p style="color:#666;font-size:13px">Keep this information confidential. Change your password after first login.</p>
""",
    )
