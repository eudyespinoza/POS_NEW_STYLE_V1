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

## Configuración de sesiones

El proyecto usa sesiones basadas en archivos para una mayor resiliencia. Por defecto se
almacenan en el directorio `sessions/` que se crea automáticamente. Este directorio debe ser
escribible y persistir durante el despliegue (por ejemplo, mediante un volumen). Puedes
personalizar la ubicación con la variable de entorno `DJANGO_SESSION_FILE_PATH`.

### Probar persistencia

Para comprobar que las sesiones se guardan correctamente:

```bash
python manage.py shell -c "from django.contrib.sessions.backends.file import SessionStore; s=SessionStore(); s['ping']='pong'; s.save(); sid=s.session_key; s2=SessionStore(session_key=sid); print(s2['ping'])"
```

La salida debe mostrar `pong`.

