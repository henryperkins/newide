Below is a practical, step-by-step guide to help you *use* Azure Database for PostgreSQL – Flexible Server with secure SSL/TLS connections and the correct root certificates. Because Azure Database for PostgreSQL – Flexible Server does **not** allow installing or replacing its built-in server certificate, the main task is to ensure your *client* trusts the certificates presented by the server and enforces encrypted connections.

---

## 1. Understand the Built-In Certificates

Azure Database for PostgreSQL – Flexible Server presents a TLS/SSL certificate that is signed by a trusted certificate authority (CA). Currently, some servers might still be under DigiCert Global Root CAs, while newer servers might be issued under the Microsoft RSA Root CA 2017 (often cross-signed by DigiCert).

> **Key point**: You **cannot** upload or replace the server’s SSL certificate. Instead, you download and trust the correct root CA certificates on the client side.

---

## 2. Download the Required Root CA Certificates

If your application uses SSL mode settings like `verify-ca` or `verify-full`, you need to *pin* (trust explicitly) the root CAs. Because Azure is transitioning to Microsoft's own CA, and some certificates are cross-signed, you should download and trust **all three** root certificates to handle existing and future server certificates:

1. **Microsoft RSA Root CA 2017**
   [Microsoft RSA Root CA 2017 certificate download](https://www.microsoft.com/pkiops/certs/Microsoft%20RSA%20Root%20Certificate%20Authority%202017.crt)

2. **DigiCert Global Root G2**
   [DigiCert Global Root G2 certificate download](https://cacerts.digicert.com/DigiCertGlobalRootG2.crt.pem)

3. **DigiCert Global Root CA**
   [DigiCert Global Root CA certificate download](https://cacerts.digicert.com/DigiCertGlobalRootCA.crt)

> **Tip**: If the files download in `.crt` format and you require `.pem` format, convert them with:
> ```bash
> openssl x509 -inform DER -in certificate.crt -out certificate.pem -outform PEM
> ```

---

## 3. Place the Certificates for Your Client

Depending on your operating system, database driver, or environment, you will need to place the root CA files into:

- **System-wide trust stores** (e.g., on Linux: `/etc/ssl/certs/` or update via distro-specific tools).
- **PostgreSQL client’s default location** (e.g., on Linux: `~/.postgresql/root.crt`; on Windows: `%APPDATA%\postgresql\root.crt`).
- **Custom location** if you want to control the file path directly.

If you place these root certificates in a single `.pem` or `.crt` file, be sure to include *all* required root certificates concatenated.

---

## 4. Configure SSL Settings in Your Client or Application

When connecting to Azure Database for PostgreSQL – Flexible Server, supply SSL parameters to ensure an encrypted connection. Common parameters include:

- **`sslmode`** (controls encryption requirement and certificate validation):
  - `disable` – No encryption.
  - `allow`/`prefer` – Will try SSL if available, falling back otherwise.
  - `require` – SSL is mandatory.
  - `verify-ca` – SSL is mandatory, and the certificate issuer is verified.
  - `verify-full` – SSL is mandatory, the CA is verified, *and* the server hostname is checked against the certificate.

  For maximum security, use `verify-full`.

- **`sslrootcert`** – Points to the root CA file containing the trusted CAs.
- **`sslcert`/`sslkey`** – If you ever use client certificates (not currently supported for authentication on Azure Database for PostgreSQL – Flexible Server, but sometimes used on other Postgres servers), specify them here.

> **Example psql command**:
> ```bash
> psql "host=<servername>.postgres.database.azure.com \
>       port=5432 \
>       user=<username> \
>       dbname=<dbname> \
>       sslmode=verify-full \
>       sslrootcert=/path/to/combined_root_cas.crt"
> ```
>
> This ensures TLS/SSL is used, the CA is trusted, and the hostname is validated against the certificate.

---

## 5. Test Your TLS/SSL Connection

1. **Use psql**:
   After connecting, psql often displays protocol and cipher details if an encrypted connection is established:
   ```
   psql (14.x)
   SSL connection (protocol: TLSv1.2, cipher: ECDHE-RSA-AES256-GCM-SHA384, bits: 256, compression: off)
   Type "help" for help.
   ```
   You can also run:
   ```sql
   CREATE EXTENSION sslinfo; 
   SELECT ssl_is_used();
   ```
   It returns `t` if SSL is used.

2. **Use openssl**:
   ```bash
   openssl s_client -starttls postgres -showcerts \
       -connect <servername>.postgres.database.azure.com:5432
   ```
   Look for the SSL handshake details (which cipher suite, which version).

---

## 6. Troubleshooting Considerations

- **TLS Version Mismatch**: Ensure your *server* setting (`ssl_min_protocol_version`) and *client* library both support a common TLS version (TLS 1.2 or higher).
- **Missing Root CA**: If you use `sslmode=verify-ca` or `verify-full`, failing to place the **correct** root CA certificate(s) on the client will cause connection errors.
- **Cross-Signed Certificates**: If the server’s certificate chain includes both Microsoft and DigiCert CAs, ensure you have *all three* root certificates present on the client to handle possible alternate trust paths.
- **Disabling SSL (not recommended)**: You can turn off enforced encryption with the parameter `require_secure_transport=OFF`, but this is generally discouraged for security reasons.

---

## Summary

1. **Download** and **install** the necessary root CA certificates (Microsoft RSA Root CA 2017, DigiCert Global Root G2, and DigiCert Global Root CA).
2. **Place** them in your client’s trusted location or specify them with `sslrootcert`.
3. **Use** `sslmode=verify-full` (or at least `verify-ca`) to ensure strong encryption and certificate validation.
4. **Verify** the SSL connection with psql commands or OpenSSL.

Following these steps ensures your database connections remain securely encrypted, prevents man-in-the-middle attacks, and handles Azure’s root CA transitions seamlessly.

---

**References & More Information**
- [Networking overview using SSL/TLS – Azure Database for PostgreSQL – Flexible Server](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-networking-ssl-tls)
- [Azure TLS certificate changes](https://learn.microsoft.com/azure/security/fundamentals/tls-certificate-changes)
- [PostgreSQL SSL/TLS Documentation](https://www.postgresql.org/docs/current/ssl-tcp.html)

If you have further questions or run into certificate-specific errors, consult the documentation above or your platform’s instructions for installing certificates.