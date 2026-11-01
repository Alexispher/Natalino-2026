# Entre Nós · Amigo Oculto Natal 2026

Site natalino com **inscrição privada e voluntária**. Nenhum nome real nem e-mail de familiares está incluído no código ou no GitHub. Data marcada: **25/11/2026**.

![status](https://img.shields.io/badge/site-GitHub%20Pages-214c3e) ![status](https://img.shields.io/badge/backend-Cloudflare%20Workers%20%2B%20D1-214c3e) ![status](https://img.shields.io/badge/e--mail-Resend-b34a40)

## Como funciona

1. Quem organiza entra no site e digita **o código de criação** privado (configurado como segredo no Cloudflare Worker).
2. O servidor cria a sala **apenas uma vez**, gera um ID aleatório difícil de adivinhar e o site mostra o link pronto para copiar/mandar no WhatsApp.
3. Cada familiar informa **seu próprio nome e e-mail** pelo link privado. O servidor armazena esses dados em um banco D1 não público; o frontend mostra só a quantidade de confirmações, **sem publicar nomes nem e-mails**. O repositório é público, mas nunca contém dados reais de inscrição.
4. O servidor envia um **código de 6 dígitos por e-mail**, válido por 15 minutos. Só a confirmação torna a inscrição válida.
5. Com oito pessoas confirmadas, o Worker executa o sorteio **no servidor** com aleatoriedade criptográfica, sem ninguém tirar a si mesmo e sem repetir destinatários.
6. Cada resultado entra numa fila **criptografada (AES-GCM)** no banco, para permitir novas tentativas em caso de falha de envio. O provedor envia **um e-mail individual** com apenas o amigo oculto da pessoa.
7. Quando o provedor aceita cada e-mail, o sistema **apaga o par criptografado** correspondente. Quando todos são enviados, o sorteio é concluído e a interface não revela os pares a ninguém.

**Importante sobre privacidade:** o navegador não recebe os resultados e o site não oferece uma tela de administração para revelá-los. Porém isso **não é sigilo criptográfico contra quem controla toda a infraestrutura**. O dono da conta de envio pode ter acesso ao conteúdo/logs dos e-mails no provedor, e alguém com acesso total ao código/segredos do servidor poderia alterá-lo antes do sorteio. Não prometa anonimato matemático ou "zero knowledge". O Worker também **não consegue garantir entrega na caixa de entrada**: ele registra que o provedor aceitou a mensagem. A família deve conferir o spam.

## O que será necessário

- Conta gratuita no **GitHub** (site estático).
- Conta no **Cloudflare** (Worker de backend e banco D1).
- Conta no **Resend** e **um domínio de envio próprio verificado** (com DNS configurado). A conta de teste do Resend **não envia para livremente para os oito familiares**. Confirme limites/preços atuais do plano antes de usar. Um domínio próprio pode ter custo.
- **Node.js 20 ou superior**, apenas para instalar/publicar o backend.

**Não funciona publicando somente o HTML no GitHub Pages.** O GitHub Pages não executa código server-side, guarda segredos nem envia e-mails de forma segura. A pasta `docs/` é o frontend; a pasta `worker/` é o serviço privado de sorteio.

## 1 · Configure o Resend

1. Crie uma conta em https://resend.com/ .
2. Adicione e verifique seu **domínio próprio** em https://resend.com/domains (siga as instruções de DNS/SPF/DKIM).
3. Crie uma **API key** com permissão de envio e guarde-a apenas para o Worker.
4. Escolha um remetente no seu domínio, por exemplo `Entre Nós <sorteio@seudominio.com>`.

Nunca coloque a chave Resend no GitHub, nem no `docs/config.js`.

## 2 · Configure o Cloudflare Worker

No terminal, dentro da pasta do projeto:

```sh
cd worker
npm install
npx wrangler login
npx wrangler d1 create entre-nos-natal-2026
```

Copie o **database_id** retornado para a linha `database_id = "..."` em `worker/wrangler.toml`.

No mesmo arquivo, substitua:

- `FRONTEND_ORIGIN`: origem exata do seu site (ex.: `https://alexispher.github.io`, **sem** `/repositorio`).
- `FROM_EMAIL`: remetente do domínio validado no Resend (ex.: `Entre Nós <sorteio@seudominio.com>`).

A seguir, crie as tabelas do banco:

```sh
npx wrangler d1 migrations apply entre-nos-natal-2026 --remote
```

Crie **quatro segredos** no Worker. Cada comando pedirá um valor, que não ficará no repositório:

```sh
npx wrangler secret put HOST_SETUP_CODE
npx wrangler secret put OTP_PEPPER
npx wrangler secret put DRAW_KEY
npx wrangler secret put RESEND_API_KEY
```

**Valores recomendados:**

- `HOST_SETUP_CODE`: uma senha longa, de no mínimo 12 caracteres, que você digitará no site somente ao criar o convite.
- `OTP_PEPPER`: um segredo aleatório, como o obtido com `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
- `DRAW_KEY`: **32 bytes aleatórios convertidos para Base64**, gerados com `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. **Não perca/troque essa chave com e-mails ainda pendentes**, senão os pares criptografados deixarão de ser legíveis e não poderão ser enviados!
- `RESEND_API_KEY`: a chave real criada no Resend.

Por último, publique:

```sh
npx wrangler deploy
```

Copie a URL pública exibida, por exemplo `https://entre-nos-natal-2026.SEUSUBDOMINIO.workers.dev`.

**Atenção:** implante todos os quatro segredos antes de receber inscrições. O Worker tem um agendamento de **1 minuto** para tentar novamente o envio dos e-mails. Isso evita um novo sorteio em caso de erro no provedor.

## 3 · Configure o frontend

Edite `docs/config.js` para usar a URL real do Worker:

```js
window.AMIGO_OCULTO_CONFIG = {
  apiBase: 'https://entre-nos-natal-2026.SEUSUBDOMINIO.workers.dev'
};
```

Essa URL é **pública**, ao contrário das quatro chaves secretas. É seguro deixá-la no GitHub.

Se seu site ficar em `https://alexispher.github.io/Natalino-2026/`, ajuste `FRONTEND_ORIGIN` do Worker para **`https://alexispher.github.io`**. Se usar domínio personalizado, use a origem desse domínio.

## 4 · Publicar no GitHub Pages

1. Crie um repositório GitHub (por exemplo, `Natalino-2026`).
2. Envie **todo este projeto** para a branch `main` sem alterar a estrutura de pastas.
3. Abra **Settings → Pages → Build and deployment** no repositório.
4. Em **Source**, escolha **Deploy from a branch**.
5. Em **Branch**, selecione **`main` e `/docs`**, clique em **Save**.
6. Abra a URL indicada no GitHub Pages. Como você está criando a sala pela primeira vez, digite o `HOST_SETUP_CODE` e clique em **Criar convite da família**.
7. Copie o link gerado e mande no grupo da família.

A página abrirá com `?evento=...` no endereço. **Não remova essa parte do link:** ela identifica a sala de forma privada. O mesmo código de criação retornará a mesma sala, evitando sorteios duplicados.

**Se alguém errar o e-mail:** antes de as oito confirmações serem concluídas, abra o convite e use **Organizador: corrigir um cadastro** com seu código privado. O cadastro antigo é liberado; não é necessário editar o banco de dados.

## 5 · Testes antes de mandar para a família

```sh
cd worker
npm test
# Para testar também cadastro, confirmação, sorteio e retry de e-mails, com Node.js 22+:
npm run test:integration
```

Esse teste faz **1.000 sorteios simulados** para verificar que ninguém tira a si mesmo, que todos recebem uma pessoa e que não há repetição.

Para validar a **entrega real**, configure primeiro Resend, Worker e domínio. Só então crie uma sala de verdade e use e-mails reais. Cuidado: uma vez que as oito pessoas confirmam, **o sorteio é irreversível** por padrão, não há botão para desfazer. Antes do sorteio, abra a sala e expanda **“Organizador: corrigir um cadastro”**. Digite o nome que a pessoa usou e o mesmo `HOST_SETUP_CODE` para excluir a inscrição anterior, permitindo que a pessoa se cadastre e confirme seu e-mail novamente. Após o sorteio, ninguém pode mudar os pares.

### Segurança e limites de proteção

- O cadastro é permitido apenas a quem conhece o **link secreto de 192 bits**, mas qualquer pessoa com o link pode tentar informar seu nome. **Confirme com a família** quem recebeu o convite. O código de e-mail prova posse da caixa de entrada, não identidade civil ou parentesco. Confirme a participação por outro canal se necessário.
- Cada participante digita seu próprio nome, recebe uma confirmação de seis dígitos, tem **5 tentativas por código**, bloqueio temporário de reenvio e limites básicos de tráfego por IP com hash.
- O servidor nunca entrega lista de participantes ou e-mails por GET nem nomes sorteados por qualquer rota pública; o resultado fica cifrado na fila até o provedor de e-mail aceitá-lo e então é apagado do banco.
- Após todos os oito envios serem aceitos pelo provedor, o sistema apaga automaticamente nomes, e-mails e fila do banco D1, preservando apenas o status agregado da sala. Inscrições não confirmadas que expiraram há mais de 24 horas também são eliminadas pelo agendamento. Isso não apaga mensagens eventualmente retidas pelo provedor de e-mail.
- O `wrangler.toml` desabilita o registro automático de observabilidade do Worker; evite ativar logs de requisições, payloads e envios. O provedor de e-mail pode reter mensagens e metadados conforme sua política.
- A chave de idempotência do Resend evita duplicações somente dentro da janela de 24 horas documentada pelo provedor; fora dela, falhas excepcionais entre o aceite do e-mail e a gravação no banco podem causar um reenvio.
- Uma conta de e-mail comprometida, um encaminhamento automático, ou acesso aos e-mails do provedor também podem expor resultados. O sistema não elimina essas possibilidades.
- Para ambientes públicos ou de grande escala, acrescente CAPTCHA/Turnstile, proteção de abuso e uma revisão de segurança independente.

## Estrutura

```
.
├── docs/                 ← frontend estático para GitHub Pages
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── config.js         ← só URL pública, sem segredos
│   └── favicon.svg
├── worker/               ← backend Cloudflare, nunca GitHub Pages
│   ├── src/index.js      ← API, verificação, sorteio e e-mails
│   ├── src/draw.js       ← sorteio seguro
│   ├── migrations/       ← SQL do banco D1
│   ├── test/             ← testes automáticos
│   ├── wrangler.toml
│   └── package.json
└── README.md
```

## Resultado

**8 inscrições privadas. 8 e-mails individuais. Nenhum auto-sorteio. Nenhuma duplicata. Nenhuma tela para revelar os pares.**

Feito para a família, com um visual natalino próprio e um backend real.