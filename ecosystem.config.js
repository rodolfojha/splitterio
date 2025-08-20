module.exports = {
  apps: [{
    name: 'splitta-io',
    script: './bin/server/server.js',
    cwd: '/var/www/splitta',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      DOMAIN: 'splittaio.com'
    },
    error_file: '/var/log/splitta/err.log',
    out_file: '/var/log/splitta/out.log',
    log_file: '/var/log/splitta/combined.log',
    time: true
  }]
};
