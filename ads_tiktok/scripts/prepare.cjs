const fs = require('fs');

async function prepare() {
  if (process.env.NODE_ENV === 'production' || !fs.existsSync('.git')) return;

  const { default: husky } = await import('husky');
  const message = husky();
  if (message) console.log(message);
}

prepare().catch((error) => {
  console.error('Không thể cài Git hooks:', error);
  process.exitCode = 1;
});
