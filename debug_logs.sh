#!/bin/bash

echo "=== MONITOREO DE LOGS DEL SERVIDOR SPLITTA ==="
echo "Presiona Ctrl+C para salir"
echo ""

# Función para mostrar logs en tiempo real
monitor_logs() {
    while true; do
        if [ -f "server.log" ]; then
            echo "=== $(date) ==="
            tail -20 server.log
            echo ""
            sleep 2
        else
            echo "Esperando archivo de log..."
            sleep 5
        fi
    done
}

# Función para mostrar logs del sistema
monitor_system_logs() {
    echo "=== LOGS DEL SISTEMA ==="
    journalctl -f -u splitta 2>/dev/null || echo "No hay servicio systemd para splitta"
}

# Función para mostrar procesos Node.js
show_processes() {
    echo "=== PROCESOS NODE.JS ACTIVOS ==="
    ps aux | grep node | grep -v grep
    echo ""
}

# Mostrar procesos iniciales
show_processes

# Iniciar monitoreo
monitor_logs

