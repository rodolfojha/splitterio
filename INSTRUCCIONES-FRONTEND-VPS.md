# 🚀 Instrucciones para Configurar Frontend en VPS Separado

## 📋 Resumen de la Configuración

- **Backend (VPS actual)**: `usa.backspitta.xyz` - Servidor Node.js con API y Socket.io
- **Frontend (Nuevo VPS)**: `splittaio.com` - Archivos estáticos servidos por Nginx

## 🔧 Pasos para Configurar el Frontend en el Nuevo VPS

### 1. Conectar al Nuevo VPS

```bash
ssh root@[IP_DEL_NUEVO_VPS]
```

### 2. Ejecutar el Script de Despliegue Automático

```bash
# Descargar el script de despliegue del frontend
wget https://raw.githubusercontent.com/rodolfojha/splitterio/master/frontend-deploy.sh

# Dar permisos de ejecución
chmod +x frontend-deploy.sh

# Ejecutar el script
./frontend-deploy.sh
```

### 3. Configuración Manual (Si el script automático no funciona)

#### 3.1 Actualizar Sistema e Instalar Dependencias

```bash
# Actualizar sistema
apt update && apt upgrade -y

# Instalar dependencias
apt install -y nginx nodejs npm git curl wget certbot python3-certbot-nginx
```

#### 3.2 Crear Usuario y Directorio

```bash
# Crear usuario para la aplicación
useradd -m -s /bin/bash splitta-frontend

# Crear directorio de la aplicación
mkdir -p /var/www/splitta-frontend
chown splitta-frontend:splitta-frontend /var/www/splitta-frontend
```

#### 3.3 Descargar y Construir Frontend

```bash
# Cambiar al directorio de la aplicación
cd /var/www/splitta-frontend

# Clonar el repositorio
sudo -u splitta-frontend git clone https://github.com/rodolfojha/splitterio.git .

# Instalar dependencias
sudo -u splitta-frontend npm install

# Construir el frontend
sudo -u splitta-frontend npm run build
```

#### 3.4 Configurar Nginx

```bash
# Crear configuración de Nginx
cat > /etc/nginx/sites-available/splitta-frontend << 'EOF'
server {
    listen 80;
    server_name splittaio.com www.splittaio.com;

    # Configuración para archivos estáticos del frontend
    root /var/www/splitta-frontend/bin/client;
    index index.html;

    # Configuración para archivos estáticos
    location / {
        try_files $uri $uri/ /index.html;
        
        # Headers de seguridad
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer-when-downgrade" always;
        add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    }

    # Configuración para archivos estáticos con cache
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Proxy para API calls al backend
    location /api/ {
        proxy_pass https://usa.backspitta.xyz;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Server $host;
    }

    # Proxy para Socket.io
    location /socket.io/ {
        proxy_pass https://usa.backspitta.xyz;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# Habilitar el sitio
ln -sf /etc/nginx/sites-available/splitta-frontend /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Verificar configuración
nginx -t

# Reiniciar Nginx
systemctl restart nginx
systemctl enable nginx
```

#### 3.5 Configurar SSL

```bash
# Obtener certificado SSL
certbot --nginx -d splittaio.com -d www.splittaio.com --non-interactive --agree-tos --email admin@splittaio.com

# Configurar renovación automática
crontab -l 2>/dev/null | { cat; echo "0 12 * * * /usr/bin/certbot renew --quiet"; } | crontab -
```

#### 3.6 Configurar Firewall

```bash
# Configurar firewall
ufw allow ssh
ufw allow 'Nginx Full'
ufw --force enable
```

## 🔧 Configuración del Backend (VPS Actual)

### 1. Actualizar Configuración de Nginx del Backend

```bash
# En el VPS actual (usa.backspitta.xyz)
cd /var/www/splitta

# Copiar la nueva configuración de Nginx
cp backend-nginx-config.conf /etc/nginx/sites-available/splitta.io

# Verificar configuración
nginx -t

# Reiniciar Nginx
systemctl restart nginx
```

### 2. Actualizar Dominio y SSL

```bash
# Obtener certificado SSL para el nuevo dominio
certbot --nginx -d usa.backspitta.xyz -d www.usa.backspitta.xyz --non-interactive --agree-tos --email admin@usa.backspitta.xyz
```

### 3. Reiniciar la Aplicación

```bash
# Reiniciar la aplicación con PM2
pm2 restart server
```

## 📝 Comandos de Mantenimiento

### Frontend (splittaio.com)

```bash
# Ver estado de Nginx
sudo systemctl status nginx

# Verificar configuración
sudo nginx -t

# Ver certificados SSL
sudo certbot certificates

# Actualizar frontend
cd /var/www/splitta-frontend
sudo -u splitta-frontend git pull
sudo -u splitta-frontend npm run build
sudo systemctl reload nginx
```

### Backend (usa.backspitta.xyz)

```bash
# Ver estado de la aplicación
pm2 status

# Ver logs
pm2 logs server

# Reiniciar aplicación
pm2 restart server

# Verificar configuración de Nginx
nginx -t
```

## 🔍 Verificación de la Configuración

### 1. Verificar Frontend

- Acceder a `https://splittaio.com`
- Verificar que la página carga correctamente
- Verificar que los archivos estáticos se sirven correctamente

### 2. Verificar Backend

- Acceder a `https://usa.backspitta.xyz/api/stats`
- Verificar que la API responde correctamente
- Verificar que Socket.io funciona desde el frontend

### 3. Verificar Conexión Frontend-Backend

- Abrir las herramientas de desarrollador del navegador
- Verificar que las llamadas a `/api/` se redirigen correctamente al backend
- Verificar que Socket.io se conecta al backend correcto

## 🚨 Solución de Problemas

### Error: "Failed to fetch"

- Verificar que el backend esté corriendo en `usa.backspitta.xyz`
- Verificar que CORS esté configurado correctamente
- Verificar que los certificados SSL sean válidos

### Error: "Socket.io connection failed"

- Verificar que Socket.io esté configurado para aceptar conexiones desde `splittaio.com`
- Verificar que el proxy de Nginx esté configurado correctamente para `/socket.io/`

### Error: "SSL certificate issues"

- Verificar que los certificados SSL estén instalados correctamente
- Verificar que los dominios estén configurados correctamente en los certificados

## 📞 Soporte

Si tienes problemas con la configuración, verifica:

1. **Logs de Nginx**: `sudo tail -f /var/log/nginx/error.log`
2. **Logs de la aplicación**: `pm2 logs server`
3. **Estado de los servicios**: `systemctl status nginx` y `pm2 status`
4. **Configuración de DNS**: Verificar que los dominios apunten a las IPs correctas

## 🎯 Resultado Final

Después de completar estos pasos:

- **Frontend**: `https://splittaio.com` - Servidor de archivos estáticos
- **Backend**: `https://usa.backspitta.xyz` - API y Socket.io
- **Comunicación**: Frontend se conecta al backend a través de proxies de Nginx
- **SSL**: Ambos dominios tienen certificados SSL válidos
- **Seguridad**: CORS configurado correctamente para permitir comunicación entre dominios
