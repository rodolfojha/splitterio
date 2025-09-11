### TODOs
| Filename | line # | TODO
|:------|:------:|:------
| client/js/app.js | 96 | Break out into GameControls.
| client/js/chat-client.js | 24 | Break out many of these GameControls into separate classes.

### IMPORTANTES
# Actualizar status y betAmount en server facilmente -> debería de actualizarse en algún sitio con el gameMoney
# Hacer que el cashout no se haga desde el frontend(se crea un betId y se maneja en caché -> En BD no es posible sin lag)
# Server.js y app.js revisar TODOS Para acabar esto
# Quitar variables importantes de gloobal.js


# Gestionar todo esto con CUSTODY
# Cuando alguien reinicie el navegador que le salga de partida devolviendole su saldo menos un 20%
# Hacer una pantalla de "En desarrollo" que consulte el estado en el backend(Base de datos) para no mostrar la web
# Lo de Browse Lobbies
# Que al salirte por tiempo te saque a lo de perdiste


### NO TAN IMPORTANTES
# Hacer un cargando mientras hace esas llamadas de cashout(que no se haga mientras se pulsa la C)
# Revisar frontend de historial pagos   
# Mejorar frontend de Stats
# Revisar TODO's de app.js en client

### MUY POCO IMPORTANTES
# Hacer que los loaders sean también(individuales) en withdrawals y depositos para el estimate

## LARGO PLACISTA
# Hacer como menú leader, con ajustes e información importante de contacto

#### HECHOS
# Hacer que se ofusque los js al hacer npm run build
# Hacer que se ofusque los html(la parte de js) al hacer npm run build