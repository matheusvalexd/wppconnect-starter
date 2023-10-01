const express = require('express');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Defina o código de autenticação
const codigoDeAutenticacao = 'seu_codigo_secreto';

const generateRandomSecretKey = () => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let secretKey = '';
  for (let i = 0; i < 8; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    secretKey += characters.charAt(randomIndex);
  }
  return secretKey;
};

// Função para modificar o arquivo config.ts
const modificarConfig = (configFilePath, porta, maxListeners, secretKey) => {
  const configFileContents = fs.readFileSync(configFilePath, 'utf-8');
  const newConfigFileContents = configFileContents
    .replace(/port: '\d+'/, `port: '${porta}'`)
    .replace(/maxListeners: \d+/, `maxListeners: ${maxListeners}`)
    .replace(/secretKey: '.*'/, `secretKey: '${secretKey}'`)
    .replace(/poweredBy: '.*'/, "poweredBy: 'Wzapi'")
    .replace(/deviceName: '.*'/, "deviceName: 'Wzapi'");

  fs.writeFileSync(configFilePath, newConfigFileContents, 'utf-8');
};

// Função para modificar o arquivo wpp na pasta /etc/nginx/sites-available
const modificarArquivoNginx = async (porta) => {
  try {
    const subdominio = `cloud${porta}.wzapi.cloud`;
    const nginxFilePath = '/etc/nginx/sites-available/wpp';

    // Ler o conteúdo do arquivo
    const nginxFileContents = fs.readFileSync(nginxFilePath, 'utf-8');

    // Adicionar o código ao final do arquivo
    const novoConteudo = `
server {
    server_name ${subdominio};
    location / {
        proxy_pass http://127.0.0.1:${porta};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }  
}
`;

    // Adicionar o novo conteúdo ao arquivo
    fs.appendFileSync(nginxFilePath, novoConteudo);
  const certbotCommand = `certbot --nginx -d ${subdominio}`;
    const { stdout, stderr } = await exec(certbotCommand);
    return true;
  } catch (err) {
    console.error('Erro ao modificar o arquivo Nginx:', err);
    return false;
  }
};

// Função assíncrona para criar instância
const criarInstancia = async (porta, maxListeners) => {
  const secretKey = generateRandomSecretKey();
  const cloneDir = `/media/root/Extensao/wppconnect-${porta}`;

  try {
    // Clonar o repositório do GitHub
    await exec(`git clone https://github.com/wppconnect-team/wppconnect-server.git ${cloneDir}`);

    // Alterar as configurações no arquivo config.ts
    const configFilePath = path.join(cloneDir, 'src', 'config.ts');
    modificarConfig(configFilePath, porta, maxListeners, secretKey);

    // Modificar o arquivo Nginx
    const modificacaoNginx = await modificarArquivoNginx(porta);

    if (!modificacaoNginx) {
      console.error('Erro ao modificar o arquivo Nginx.');
      return { success: false, error: 'Erro ao criar a instância.' };
    }

    // Retornar a resposta com sucesso
    return {
      success: true,
      message: 'Instância criada com sucesso.',
      pasta: `wppconnect-${porta}`,
      secretKey: secretKey,
    };
  } catch (err) {
    console.error('Erro ao criar instância:', err);
    return { success: false, error: 'Erro ao criar a instância.' };
  }
};

// Endpoint para criar a instância
app.post('/criar-instancia', async (req, res) => {
  // Verifique se o cabeçalho Authorization está presente na solicitação
  const authHeader = req.headers['authorization'];

  if (!authHeader || authHeader !== `Bearer ${codigoDeAutenticacao}`) {
    return res.status(401).json({ error: 'Acesso não autorizado.' });
  }

  const { porta, maxListeners } = req.body;

  if (!porta || !maxListeners) {
    return res.status(400).json({ error: 'Os parâmetros "porta" e "maxListeners" são obrigatórios.' });
  }

  try {
    // Chame a função assíncrona para criar a instância
    const resultado = await criarInstancia(porta, maxListeners);

    if (resultado.success) {
      // Retorne a resposta de sucesso
      return res.status(200).json(resultado);
    } else {
      // Em caso de erro, retorne uma resposta de erro
      return res.status(500).json({ error: resultado.error });
    }
  } catch (err) {
    console.error('Erro ao criar instância:', err);
    return res.status(500).json({ error: 'Erro ao criar a instância.' });
  }
});

// Endpoint para construir a instância (npm install e npm run build)
app.post('/buildar-instancia', async (req, res) => {
  // Este endpoint não requer autenticação, pois não cria uma instância completa,
  // apenas executa o npm install e npm run build em segundo plano.

  const { porta } = req.body;

  if (!porta) {
    return res.status(400).json({ error: 'O parâmetro "porta" é obrigatório.' });
  }

  try {
    const cloneDir = `/media/root/Extensao/wppconnect-${porta}`;

    // Iniciar o npm install em segundo plano
    await exec(`cd ${cloneDir} && npm install`);

    // Iniciar o npm run build em segundo plano
    await exec(`cd ${cloneDir} && npm run build`);

    // Retornar uma resposta de sucesso imediata
    return res.status(200).json({ success: true, message: 'Construção iniciada com sucesso.' });
  } catch (err) {
    console.error('Erro ao construir a instância:', err);
    return res.status(500).json({ error: 'Erro ao construir a instância.' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
