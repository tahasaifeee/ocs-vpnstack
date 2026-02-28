FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ocserv \
    gnutls-bin \
    iptables \
    iproute2 \
    oathtool \
    ca-certificates \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /etc/ocserv/conf.d /etc/ocserv/user-routes /var/log/ocserv /run/ocserv \
             /opt/ocserv-defaults

# Store config/scripts in an image-only path so the entrypoint can always
# stamp them into the volume-mounted /etc/ocserv on container start.
COPY ocserv.conf   /opt/ocserv-defaults/ocserv.conf
COPY connect.sh    /opt/ocserv-defaults/connect.sh
COPY disconnect.sh /opt/ocserv-defaults/disconnect.sh
COPY entrypoint.sh /entrypoint.sh

RUN chmod +x /opt/ocserv-defaults/connect.sh \
             /opt/ocserv-defaults/disconnect.sh \
             /entrypoint.sh

EXPOSE 443/tcp 443/udp

ENTRYPOINT ["/entrypoint.sh"]
