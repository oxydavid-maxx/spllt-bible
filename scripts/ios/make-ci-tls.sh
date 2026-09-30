#!/usr/bin/env bash
# scripts/ios/make-ci-tls.sh <dir> — a throwaway CA and a localhost certificate for one CI run. The CA is trusted
# only inside the CI simulator (xcrun simctl keychain add-root-cert); nothing is kept. iOS wants a server
# certificate with a SAN, serverAuth and a short validity, so the leaf is signed by a separate CA.
set -euo pipefail
DIR=$1; mkdir -p "$DIR"; cd "$DIR"
openssl genrsa -out ca.key 2048 2>/dev/null
openssl req -new -key ca.key -subj "/CN=qingmu CI root" -out ca.csr
printf 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n' > ca.ext
openssl x509 -req -in ca.csr -signkey ca.key -days 2 -sha256 -extfile ca.ext -out ca.pem 2>/dev/null
openssl genrsa -out leaf.key 2048 2>/dev/null
openssl req -new -key leaf.key -subj "/CN=localhost" -out leaf.csr
printf 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n' > leaf.ext
openssl x509 -req -in leaf.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 2 -sha256 -extfile leaf.ext -out leaf.pem 2>/dev/null
