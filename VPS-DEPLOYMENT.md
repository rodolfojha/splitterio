# 🚀 Despliegue de Splitta.io en VPS

## 📋 Requisitos Previos

- VPS con Ubuntu 18.04+ o Debian 9+
- Acceso SSH como root
- Dominio configurado (opcional para SSL)
- IP del VPS: `128.254.207.105`

## 🔧 Pasos de Despliegue

### 1. Conectar al VPS

```bash
ssh root@128.254.207.105
```

### 2. Descargar y ejecutar el script de despliegue

```bash
# Descargar el script
wget https://raw.githubusercontent.com/rodolfojha/splitterio/master/deploy-vps.sh

# Dar permisos de ejecución
chmod +x deploy-vps.sh

# Ejecutar el script
./deploy-vps.sh
```

### 3. Verificar la instalación

```bash
# Verificar que PM2 esté corriendo
pm2 status

# Verificar que Nginx esté activo
systemctl status nginx

# Verificar que el puerto 3000 esté escuchando
netstat -tlnp | grep :3000
```

### 4. Acceder a la aplicación

Una vez completado el despliegue, puedes acceder a tu aplicación en:
- **URL:** http://128.254.207.105
- **Puerto:** 80 (HTTP)

## 🌐 Configuración de Dominio (Opcional)

Si tienes un dominio, puedes configurar SSL:

```bash
# Descargar el script de configuración de dominio
wget https://raw.githubusercontent.com/rodolfojha/splitterio/master/setup-domain.sh

# Dar permisos de ejecución
chmod +x setup-domain.sh

# Ejecutar el script
./setup-domain.sh
```

## 📁 Estructura del Despliegue

```
/var/www/splitta/          # Directorio principal de la aplicación
├── src/                   # Código fuente
├── bin/                   # Archivos compilados
├── node_modules/          # Dependencias
├── ecosystem.config.js    # Configuración PM2
└── package.json          # Configuración del proyecto

/var/log/splitta/         # Logs de la aplicación
├── err.log              # Errores
├── out.log              # Salida estándar
└── combined.log         # Logs combinados

/etc/nginx/sites-available/splitta.io  # Configuración Nginx
```

## 🔧 Comandos de Mantenimiento

### Gestión de la aplicación (PM2)

```bash
# Ver estado de la aplicación
pm2 status

# Ver logs en tiempo real
pm2 logs splitta-io

# Reiniciar la aplicación
pm2 restart splitta-io

# Detener la aplicación
pm2 stop splitta-io

# Iniciar la aplicación
pm2 start splitta-io

# Ver información detallada
pm2 show splitta-io
```

### Gestión de Nginx

```bash
# Verificar configuración
nginx -t

# Recargar configuración
systemctl reload nginx

# Reiniciar Nginx
systemctl restart nginx

# Ver estado
systemctl status nginx

# Ver logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

### Actualización del código

```bash
# Cambiar al usuario splitta
su - splitta

# Ir al directorio de la aplicación
cd /var/www/splitta

# Obtener cambios del repositorio
git pull origin master

# Instalar nuevas dependencias (si las hay)
npm install

# Reconstruir el proyecto
npm run build

# Reiniciar la aplicación
pm2 restart splitta-io
```

## 🔒 Configuración de Firewall

El script configura automáticamente el firewall (UFW):

- **Puerto 22:** SSH
- **Puerto 80:** HTTP
- **Puerto 443:** HTTPS (cuando se configure SSL)

Para verificar:
```bash
ufw status
```

## 📊 Monitoreo

### Ver uso de recursos

```bash
# Ver uso de CPU y memoria
htop

# Ver uso de disco
df -h

# Ver procesos de Node.js
ps aux | grep node
```

### Logs importantes

```bash
# Logs de la aplicación
tail -f /var/log/splitta/combined.log

# Logs de Nginx
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log

# Logs del sistema
journalctl -u nginx -f
```

## 🚨 Solución de Problemas

### La aplicación no responde

```bash
# Verificar si PM2 está corriendo
pm2 status

# Verificar logs de la aplicación
pm2 logs splitta-io

# Verificar si el puerto 3000 está en uso
netstat -tlnp | grep :3000
```

### Nginx no funciona

```bash
# Verificar configuración
nginx -t

# Verificar estado
systemctl status nginx

# Ver logs de error
tail -f /var/log/nginx/error.log
```

### Problemas de SSL

```bash
# Verificar certificados
certbot certificates

# Renovar certificados manualmente
certbot renew

# Verificar renovación automática
crontab -l
```

## 🔄 Backup y Restauración

### Crear backup

```bash
# Backup de la aplicación
tar -czf splitta-backup-$(date +%Y%m%d).tar.gz /var/www/splitta

# Backup de la base de datos
cp /var/www/splitta/src/server/db/db.sqlite3 splitta-db-backup-$(date +%Y%m%d).sqlite3
```

### Restaurar backup

```bash
# Restaurar aplicación
tar -xzf splitta-backup-YYYYMMDD.tar.gz -C /

# Restaurar base de datos
cp splitta-db-backup-YYYYMMDD.sqlite3 /var/www/splitta/src/server/db/db.sqlite3

# Reiniciar aplicación
pm2 restart splitta-io
```

## 📞 Soporte

Si encuentras problemas durante el despliegue:

1. Verifica los logs de la aplicación
2. Revisa la configuración de Nginx
3. Asegúrate de que todos los puertos estén abiertos
4. Verifica que el dominio apunte a la IP correcta

## 🎯 Próximos Pasos

1. **Configurar dominio y SSL** (si tienes uno)
2. **Configurar backup automático**
3. **Configurar monitoreo** (opcional)
4. **Optimizar rendimiento** (opcional)

---

**¡Tu aplicación Splitta.io estará disponible en http://128.254.207.105!** 🎮
