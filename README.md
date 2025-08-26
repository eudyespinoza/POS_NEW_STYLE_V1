# MyPOS_FBM

## Configuración de OpenSSL

La aplicación requiere acceso al binario de OpenSSL. Si `openssl` no se encuentra en el `PATH` del sistema, es necesario definir la variable de entorno `OPENSSL_PATH` apuntando a la ruta completa del ejecutable.

Ejemplo en un archivo `.env`:

```env
OPENSSL_PATH=/usr/local/opt/openssl/bin/openssl
```

O definiendo la variable en el entorno del sistema:

```bash
export OPENSSL_PATH=/usr/local/opt/openssl/bin/openssl
```

Asegúrate de que la ruta coincida con la ubicación real del binario de OpenSSL en tu sistema.

