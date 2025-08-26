# Configuración de Pagos con NOWPayments

## Nueva Implementación de Pagos

Se ha implementado una nueva solución de pagos usando NOWPayments que incluye:

### Características Implementadas

1. **Selección de Criptomonedas**: Los usuarios pueden elegir entre múltiples criptomonedas disponibles
2. **Estimación de Precios**: Muestra la tasa de cambio en tiempo real
3. **Código QR**: Genera automáticamente un código QR para facilitar el pago
4. **Dirección de Wallet**: Muestra la dirección específica para el pago
5. **Verificación de Estado**: Permite verificar el estado del pago en tiempo real
6. **Webhooks**: Recibe notificaciones automáticas cuando se confirma el pago

### Configuración Requerida

#### 1. Crear cuenta en NOWPayments
- Ve a [nowpayments.io](https://nowpayments.io)
- Regístrate y verifica tu cuenta
- Configura tu wallet de destino

#### 2. Obtener API Key
- Ve a tu dashboard de NOWPayments
- Genera una nueva API Key
- Copia la API Key

#### 3. Configurar Variables de Entorno
Crea un archivo `.env` en la raíz del proyecto:

```env
NOWPAYMENTS_API_KEY=tu_api_key_aqui
NOWPAYMENTS_IPN_SECRET=tu_ipn_secret_aqui
```

#### 4. Configurar Webhook URL
En tu dashboard de NOWPayments, configura la URL del webhook:
```
https://tu-dominio.com/api/payment-webhook
```

### Endpoints de la API

#### GET /api/currencies
Obtiene la lista de criptomonedas disponibles para pagos.

#### GET /api/estimate?amount=X&crypto=Y
Obtiene una estimación del monto en criptomoneda para un monto en USD.

#### POST /api/create-payment
Crea un nuevo pago con los siguientes parámetros:
```json
{
  "amount": 10.00,
  "crypto": "btc"
}
```

#### GET /api/payment-status?payment_id=X
Verifica el estado de un pago específico.

#### POST /api/payment-webhook
Webhook que recibe notificaciones de NOWPayments sobre el estado de los pagos.

### Flujo de Pago

1. **Usuario selecciona criptomoneda**: Elige entre las opciones disponibles
2. **Ingresa monto**: Especifica el monto en USD que desea pagar
3. **Obtiene estimación**: Ve la cantidad exacta en criptomoneda que debe enviar
4. **Crea pago**: Se genera una dirección única para el pago
5. **Envía criptomoneda**: El usuario envía la cantidad exacta a la dirección mostrada
6. **Confirmación automática**: El sistema detecta el pago y actualiza el balance automáticamente

### Criptomonedas Soportadas

- Bitcoin (BTC)
- Ethereum (ETH)
- Tether (USDT, USDTTRC20, USDTERC20)
- Dogecoin (DOGE)
- Litecoin (LTC)
- BNB
- Cardano (ADA)
- Ripple (XRP)
- Y muchas más según disponibilidad de NOWPayments

### Seguridad

- Todas las transacciones se verifican mediante webhooks
- Los pagos se validan contra la base de datos local
- Se implementa verificación de firmas para los webhooks
- Los montos se calculan en tiempo real para evitar manipulación

### Monitoreo

Los pagos se registran en la tabla `payments` con los siguientes estados:
- `waiting`: Esperando pago
- `confirming`: Pago confirmándose en la blockchain
- `confirmed`: Pago confirmado
- `finished`: Pago completado
- `failed`: Pago fallido
- `expired`: Pago expirado

### Troubleshooting

#### Error: "Error obteniendo monedas disponibles"
- Verifica que la API Key sea correcta
- Asegúrate de que tu cuenta esté verificada en NOWPayments

#### Error: "Error al crear el pago"
- Verifica que el monto sea válido (mínimo $10 USD)
- Asegúrate de que la criptomoneda esté disponible
- Verifica la conectividad con la API de NOWPayments

#### Los pagos no se confirman automáticamente
- Verifica que la URL del webhook esté configurada correctamente
- Asegúrate de que el servidor sea accesible desde internet
- Revisa los logs del servidor para errores en el webhook

### Notas Importantes

- Los pagos tienen un tiempo límite de 20 minutos
- Solo se aceptan pagos exactos (no se aceptan montos menores)
- Los pagos se procesan automáticamente una vez confirmados en la blockchain
- Se recomienda usar criptomonedas con confirmaciones rápidas para mejor experiencia de usuario




