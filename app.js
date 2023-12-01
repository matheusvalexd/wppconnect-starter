const express = require('express');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');
const path = require('path');
const pm2 = require('pm2');
const axios = require('axios');
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
    const nginxFilePath = `/etc/nginx/sites-available/wpp${porta}`;
    const nginxFileEnabled = `/etc/nginx/sites-enabled/wpp${porta}`;

    // Ler o conteúdo do arquivo
    //const nginxFileContents = fs.readFileSync(nginxFilePath, 'utf-8');

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
    fs.writeFileSync(nginxFilePath, novoConteudo);

    await exec(`ln -s ${nginxFilePath} ${nginxFileEnabled}`);
    return true;
  } catch (err) {
    console.error('Erro ao modificar o arquivo Nginx:', err);
    return false;
  }
};

// Função assíncrona para criar instância
const criarInstancia = async (porta, maxListeners) => {
  const secretKey = generateRandomSecretKey();
  const cloneDir = `/root/Whatsappis/wppconnect-${porta}`;

  try {
    // Clonar o repositório do GitHub
    await exec(`git clone https://github.com/wppconnect-team/wppconnect-server.git ${cloneDir}`);
    await exec(`ln -s /root/wppconnect-server/node_modules ${cloneDir}`);

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
const construirInstanciaEmSegundoPlano = async (porta, secretKey) => {
  try {
    const cloneDir = `/root/Whatsappis/wppconnect-${porta}`;
    const subdominio = `cloud${porta}.wzapi.cloud`;

    // Iniciar o npm install em segundo plano
   // console.log(`Executando 'npm install' na pasta ${cloneDir}...`);
   // await exec(`cd ${cloneDir} && npm install`);
    //console.log(`'npm install' concluído na pasta ${cloneDir}.`);

    // Iniciar o npm run build em segundo plano
    console.log(`Executando 'npm run build' na pasta ${cloneDir}...`);
    await exec(`cd ${cloneDir} && npm run build && pm2 start npm --name wpp${porta} -- start && certbot --nginx -d ${subdominio} && pm2 save`);
    console.log(`'npm run build' concluído na pasta ${cloneDir}.`);

    const webhookData = {
  porta: porta,
  dominio: subdominio,
  secretKey: secretKey,
};

// URL do webhook
const webhookUrl = 'https://webhook.site/3595ea4c-9944-4978-aa2e-a004c240d6d1';

try {
  // Faz a requisição POST para o webhook com os dados
  const response = await axios.post(webhookUrl, webhookData);
  console.log('Webhook enviado com sucesso:', response.data);
} catch (error) {
  console.error('Erro ao enviar o webhook:', error.message);
}
  } catch (err) {
    console.error(`Erro ao construir a instância para a porta ${porta}:`, err);
  }
};

// Endpoint para construir a instância (npm install e npm run build)
app.post('/buildar-instancia', async (req, res) => {
  // Este endpoint não requer autenticação, pois não cria uma instância completa,
  // apenas inicia o processo de construção em segundo plano.

  const { porta } = req.body;
  const { secretKey } = req.body;
  
  if (!porta) {
    return res.status(400).json({ error: 'O parâmetro "porta" é obrigatório.' });
  }

  // Inicie o processo de construção em segundo plano
  construirInstanciaEmSegundoPlano(porta, secretKey);

  // Retorne uma resposta de sucesso imediata
  console.log(`Construção para a porta ${porta} iniciada com sucesso.`);
  return res.status(200).json({ success: true, message: 'Construção iniciada com sucesso.' });
});

// Endpoint para verificar se a aplicação está online no PM2
app.post('/consulta-online', async (req, res) => {
  const { porta } = req.body;

  if (!porta) {
    return res.status(400).json({ error: 'O parâmetro "porta" é obrigatório.' });
  }

  const nomeDaAplicacao = `wpp${porta}`;

  // Conecte-se ao PM2
  pm2.connect((err) => {
    if (err) {
      console.error('Erro ao conectar-se ao PM2:', err);
      return res.status(500).json({ error: 'Erro ao consultar o PM2.' });
    }

    // Verifique o status da aplicação no PM2
    pm2.describe(nomeDaAplicacao, (err, apps) => {
      if (err) {
        console.error(`Erro ao consultar o status da aplicação ${nomeDaAplicacao}:`, err);
        pm2.disconnect();
        return res.status(500).json({ error: 'Erro ao consultar o PM2.' });
      }

      // Verifique se a aplicação está online
      if (apps.length === 0 || apps[0].pm2_env.status !== 'online') {
        pm2.disconnect();
        return res.status(200).json({ online: false, message: 'A aplicação não está online.' });
      }

      pm2.disconnect();
      return res.status(200).json({ online: true, message: 'A aplicação está online.' });
    });
  });
});


// Função assíncrona para deletar uma instância
const deletarInstancia = async (porta) => {
  const cloneDir = `/root/Whatsappis/wppconnect-${porta}`;
  const arquivoNginx = `/etc/nginx/sites-available/wpp${porta}`;
  const arquivoNginxEn = `/etc/nginx/sites-enabled/wpp${porta}`;

  try {
    // Parar e remover a aplicação do PM2
    await exec(`pm2 delete wpp${porta}`);

    // Remover a pasta da instância
    await exec(`rm -rf ${cloneDir}`);
    
        // Remover a pasta da instância
    await exec(`rm  ${arquivoNginx}`);
    await exec(`rm  ${arquivoNginxEn}`);

      // Remover o certificado do Certbot
    await exec(`certbot delete --cert-name cloud${porta}.wzapi.cloud --non-interactive`);

    // Retornar a resposta com sucesso
    return {
      success: true,
      message: 'Instância deletada com sucesso.',
    };
  } catch (err) {
    console.error('Erro ao deletar instância:', err);
    return { success: false, error: 'Erro ao deletar a instância.' };
  }
};

// Endpoint para deletar a instância
app.post('/delete-instancia', async (req, res) => {
  // Verifique se o cabeçalho Authorization está presente na solicitação
  const authHeader = req.headers['authorization'];

  if (!authHeader || authHeader !== `Bearer ${codigoDeAutenticacao}`) {
    return res.status(401).json({ error: 'Acesso não autorizado.' });
  }

  const { porta } = req.body;

  if (!porta) {
    return res.status(400).json({ error: 'O parâmetro "porta" é obrigatório.' });
  }

  try {
    // Chame a função assíncrona para deletar a instância
    const resultado = await deletarInstancia(porta);

    if (resultado.success) {
      // Retorne a resposta de sucesso
      return res.status(200).json(resultado);
    } else {
      // Em caso de erro, retorne uma resposta de erro
      return res.status(500).json({ error: resultado.error });
    }
  } catch (err) {
    console.error('Erro ao deletar instância:', err);
    return res.status(500).json({ error: 'Erro ao deletar a instância.' });
  }
});


app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
