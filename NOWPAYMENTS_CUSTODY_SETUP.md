# Configuración de NOWPayments Custody

Este documento explica cómo configurar y usar la funcionalidad de NOWPayments Custody para crear automáticamente subusers cuando se registran nuevos usuarios.

## Requisitos Previos

1. **Cuenta de NOWPayments**: Debes tener una cuenta activa en NOWPayments
2. **API Key**: Necesitas tu API Key de NOWPayments
3. **JWT Token**: Necesitas obtener un JWT Token para usar los endpoints de custody

## Configuración

### 1. Variables de Entorno

Agrega las siguientes variables a tu archivo `.env`:

```env
# NOWPayments Configuration
NOWPAYMENTS_API_KEY=tu_api_key_aqui
NOWPAYMENTS_IPN_SECRET=tu_ipn_secret_aqui
NOWPAYMENTS_JWT_TOKEN=tu_jwt_token_aqui
```

### 2. Base de Datos

Ejecuta el script de migración en tu servidor MySQL:

```sql
-- Ejecutar en tu servidor de base de datos MySQL
ALTER TABLE users ADD COLUMN nowpayments_custody_id VARCHAR(50) NULL;
CREATE INDEX idx_users_nowpayments_custody_id ON users(nowpayments_custody_id);
ALTER TABLE users MODIFY COLUMN nowpayments_custody_id VARCHAR(50) NULL COMMENT 'ID del subuser custody en NOWPayments';
```

O ejecuta el archivo de migración:
```bash
mysql -u tu_usuario -p tu_base_de_datos < migrations/add_nowpayments_custody_id.sql
```

### 3. Obtener JWT Token

Para obtener el JWT Token de NOWPayments:

1. Ve a tu dashboard de NOWPayments
2. Navega a la sección de API
3. Genera un JWT Token para usar con los endpoints de custody
4. Copia el token y agrégalo a tu archivo `.env`

## Funcionalidad

### Creación Automática de Custody

Cuando un nuevo usuario se registra a través de Google OAuth:

1. Se crea automáticamente un subuser custody en NOWPayments
2. El ID del custody se guarda en la base de datos
3. Si falla la creación del custody, el usuario se crea igual (sin custody ID)

### Endpoints Disponibles

#### POST `/api/create-custody`

Crea un custody para un usuario existente que no tiene custody ID.

**Headers:**
```
Authorization: Bearer <session_token>
```

**Respuesta exitosa:**
```json
{
  "success": true,
  "message": "Custody creado exitosamente",
  "custodyId": "123456789"
}
```

**Respuesta si ya tiene custody:**
```json
{
  "success": true,
  "message": "Usuario ya tiene custody ID",
  "custodyId": "123456789"
}
```

### Servicios Disponibles

El servicio `NowPaymentsCustodyService` proporciona los siguientes métodos:

- `createCustodyUser(userName)`: Crear un nuevo custody user
- `getCustodyBalance(custodyId)`: Obtener balance de un custody user
- `getCustodyUsers(options)`: Obtener lista de custody users
- `createCustodyDeposit(custodyId, currency, amount)`: Crear depósito para custody user

## Uso

### Para Usuarios Nuevos

Los usuarios nuevos que se registren a través de Google OAuth tendrán automáticamente un custody creado.

### Para Usuarios Existentes

Si tienes usuarios existentes que no tienen custody ID, puedes:

1. **Usar el endpoint**: Hacer una petición POST a `/api/create-custody`
2. **Usar el servicio directamente**: Llamar a `authRepository.createCustodyForExistingUser(userId)`

### Ejemplo de Uso del Endpoint

```javascript
// Crear custody para usuario actual
fetch('/api/create-custody', {
    method: 'POST',
    headers: {
        'Authorization': 'Bearer ' + sessionToken,
        'Content-Type': 'application/json'
    }
})
.then(response => response.json())
.then(data => {
    if (data.success) {
        console.log('Custody creado:', data.custodyId);
    } else {
        console.error('Error:', data.message);
    }
});
```

## Monitoreo y Logs

El sistema registra todas las operaciones de custody en los logs:

- `[NOWPAYMENTS_CUSTODY]`: Logs del servicio de custody
- `[AUTH_REPO]`: Logs del repositorio de autenticación
- `[CUSTODY]`: Logs del endpoint de creación de custody

## Manejo de Errores

El sistema maneja los siguientes escenarios de error:

1. **API Key no configurada**: Error si `NOWPAYMENTS_API_KEY` no está definida
2. **JWT Token no configurado**: Error si `NOWPAYMENTS_JWT_TOKEN` no está definida
3. **Nombre inválido**: Error si el nombre del usuario es un email o excede 30 caracteres
4. **Error de API**: Errores de comunicación con NOWPayments
5. **Error de base de datos**: Errores al guardar el custody ID

## Consideraciones Importantes

1. **Nombres únicos**: Los nombres de custody deben ser únicos y no pueden ser emails
2. **Límite de caracteres**: Los nombres no pueden exceder 30 caracteres
3. **Fallback**: Si falla la creación del custody, el usuario se crea igual
4. **Idempotencia**: Crear custody para un usuario que ya lo tiene no causa error

## Troubleshooting

### Error: "NOWPAYMENTS_JWT_TOKEN no está configurada"

- Verifica que la variable `NOWPAYMENTS_JWT_TOKEN` esté en tu archivo `.env`
- Asegúrate de que el token sea válido y no haya expirado

### Error: "El nombre del custody no puede ser un email"

- El sistema usa el `username` del usuario, no el email
- Verifica que el `username` no contenga el símbolo `@`

### Error: "Error creando custody user: 401"

- Verifica que tu JWT Token sea válido
- Asegúrate de que tu cuenta de NOWPayments tenga permisos para crear custody users

### Usuarios existentes sin custody

- Usa el endpoint `/api/create-custody` para crear custody para usuarios existentes
- O ejecuta manualmente: `authRepository.createCustodyForExistingUser(userId)`


