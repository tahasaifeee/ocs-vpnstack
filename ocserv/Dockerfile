FROM alpine:3.19

RUN apk add --no-cache \
    ocserv \
    gnutls-utils \
    iptables \
    bash \
    iproute2 \
    oath-toolkit-oathtool \
    ca-certificates \
    tzdata

RUN mkdir -p /etc/ocserv/conf.d /etc/ocserv/user-routes /var/log/ocserv /run/ocserv

COPY ocserv.conf /etc/ocserv/ocserv.conf
COPY connect.sh /etc/ocserv/connect.sh
COPY disconnect.sh /etc/ocserv/disconnect.sh

RUN chmod +x /etc/ocserv/connect.sh /etc/ocserv/disconnect.sh

# Generate self-signed cert if none provided
RUN if [ ! -f /etc/ocserv/server.crt ]; then \
    certtool --generate-privkey --outfile /etc/ocserv/server.key && \
    certtool --generate-self-signed \
        --load-privkey /etc/ocserv/server.key \
        --outfile /etc/ocserv/server.crt \
        --template /dev/stdin <<EOF
cn = "VPN Server"
organization = "VPN"
serial = 1
expiration_days = 3650
signing_key
tls_www_server
EOF
    fi

EXPOSE 443/tcp 443/udp

CMD ["ocserv", "--foreground", "--config", "/etc/ocserv/ocserv.conf"]
