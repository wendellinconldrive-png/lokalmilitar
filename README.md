# Here are your Instructions
# lokalmilitar

## Publicação

O frontend é publicado na Vercel, a API FastAPI no Render e o banco no MongoDB Atlas. O arquivo `render.yaml` configura o serviço da API sem armazenar credenciais no repositório.

A API comprime respostas HTTP maiores com gzip e carrega assinaturas de pedidos e vendedores somente quando necessárias, reduzindo tráfego e o tempo de carregamento das listas. O dashboard também reutiliza as categorias obtidas pela própria API. O consumo e o desempenho ainda dependem do volume de uso e dos arquivos enviados.

Pedidos novos começam como **Separado**, que não movimenta o estoque. Ao marcar como **Entregue** ou **Retirado**, o sistema registra as saídas dos itens e as entradas dos itens em `returned_items`; as devoluções vinculadas também aparecem em **Trocas/Devoluções**. **Cancelado** estorna as saídas já lançadas sem remover entradas de devoluções recebidas. Administradores podem concluir sem assinatura; os demais usuários precisam registrar a assinatura do cliente. O fechamento apresenta as movimentações e cria um backup.

O fechamento automático às 19h (horário de Brasília) e o aviso às 18h50 são executados pelo navegador enquanto uma sessão de administrador estiver aberta. O aviso dentro do sistema funciona nessa condição; a notificação do navegador também exige permissão concedida. Sem um navegador aberto, o fechamento automático não será executado. Um Render Cron poderia garantir a execução em segundo plano, mas não está incluído para evitar o custo mensal adicional desse serviço. Após o fechamento, os tokens existentes são invalidados em todos os dispositivos.

### 1. Criar o banco no MongoDB Atlas

1. Crie um cluster e um usuário de banco de dados no Atlas.
2. Configure o acesso de rede do Atlas para permitir conexões da API no Render.
3. Copie a URI de conexão do cluster. Guarde-a como segredo; não a adicione a arquivos do projeto nem a compartilhe em mensagens.

### 2. Publicar a API no Render

1. No Render, crie um **Blueprint** a partir deste repositório e confirme o serviço `lokalmilitar-api` definido em `render.yaml`.
2. Quando solicitado, informe `MONGO_URL` com a URI do Atlas. O Blueprint define `DB_NAME` como `lokalmilitar`, gera `JWT_SECRET` e solicita `CORS_ORIGINS`.
3. Faça o deploy e copie a URL pública da API, por exemplo `https://lokalmilitar-api.onrender.com`.
4. Confirme que a API responde em `https://<URL-DA-API>/docs`.

### Criar o primeiro administrador

Em um banco novo, nenhum usuário é criado automaticamente. Para inicializar o acesso:

1. Gere um segredo aleatório com pelo menos 32 caracteres e adicione-o temporariamente ao serviço da API no Render como `ADMIN_BOOTSTRAP_TOKEN`. Não o salve no repositório nem o compartilhe.
2. Aguarde o novo deploy e abra `https://<URL-DA-API>/docs`.
3. Execute `POST /api/auth/bootstrap-admin`, informando o cabeçalho `X-Admin-Bootstrap-Token` com o segredo e o corpo com `name`, `email` e `password`. A senha precisa ter pelo menos 12 caracteres.
4. Depois de receber sucesso, remova `ADMIN_BOOTSTRAP_TOKEN` do Render e faça outro deploy. O endpoint só funciona enquanto esse segredo estiver configurado e o banco não tiver usuários; um bloqueio no banco impede inicializações concorrentes ou repetidas.
5. Entre no frontend com o e-mail e a senha informados. O administrador poderá então gerar convites em **Configurações → Convites para cadastro**.

### Redefinir a senha do administrador

Se o administrador existente não conseguir entrar:

1. Gere um segredo aleatório com pelo menos 32 caracteres e configure-o temporariamente no Render como `ADMIN_PASSWORD_RESET_TOKEN`.
2. Após o deploy, abra `/docs` da API e execute `POST /api/auth/reset-admin-password`, enviando `X-Admin-Reset-Token` e o e-mail exato da conta `admin`, além de uma nova senha com pelo menos 12 caracteres.
3. Após sucesso, remova `ADMIN_PASSWORD_RESET_TOKEN` do Render e faça um novo deploy. O reset só pode ser concluído uma vez por banco; não reutilize a senha antiga.

### Acesso público temporário

Para permitir acesso sem login, configure `PUBLIC_ACCESS_MODE=true` nas variáveis do serviço da API no Render e publique uma nova versão do frontend. A tela de login continuará disponível e mostrará **Acessar sem login**; chamadas à API sem autenticação receberão permissões administrativas enquanto o modo estiver ativo. Isso expõe todos os dados e permite alterações por qualquer pessoa, inclusive criação e administração de usuários. Use apenas como medida temporária. Para restaurar a autenticação, remova `PUBLIC_ACCESS_MODE` ou defina-o como `false` e faça novo deploy do backend; os usuários e dados existentes serão preservados.

### 3. Publicar o frontend na Vercel

1. Importe este repositório na Vercel e defina **Root Directory** como `frontend`.
2. Use o preset **Create React App**, o comando de build `yarn build` e o diretório de saída `build`. A Vercel pode detectar essas configurações automaticamente.
3. Em **Settings → Environment Variables**, configure `REACT_APP_BACKEND_URL` com a URL pública da API, sem acrescentar `/api` ao final.
4. Faça o deploy e copie a origem pública do frontend, sem barra final, por exemplo `https://meu-projeto.vercel.app`.

### 4. Restringir o CORS da API

No Render, defina `CORS_ORIGINS` com a origem pública do frontend da Vercel, sem barra no final, e faça um novo deploy da API. Se usar domínios adicionais (como um domínio próprio), inclua cada origem separada por vírgula.

### 5. Conectar Google Agenda e notificações

1. No Google Cloud Console, crie ou selecione um projeto, ative a **Google Calendar API** e configure a tela de consentimento OAuth.
2. Crie um cliente OAuth do tipo **Aplicativo da Web**. Cadastre como URI de redirecionamento autorizado `https://<URL-DA-API>/api/integrations/google-calendar/callback`. O escopo solicitado é `calendar.events`; o Google pode exigir a publicação/verificação do consentimento para uso fora dos usuários de teste.
3. Configure no Render, como variáveis privadas do serviço da API:
   - `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` do cliente OAuth.
   - `GOOGLE_REDIRECT_URI` com a mesma URL cadastrada no Google.
   - `FRONTEND_URL` com a origem do frontend na Vercel, sem barra final.
   - `GOOGLE_TOKEN_ENCRYPTION_KEY`, gerada uma única vez com `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. Guarde essa chave: mudar ou perder a chave exige reconectar a conta Google.
4. Gere as chaves VAPID para Web Push localmente, com as dependências do backend instaladas:

   ```python
   import base64
   from cryptography.hazmat.primitives import serialization
   from py_vapid import Vapid

   key = Vapid()
   key.generate_keys()
   private_key = key.private_key.private_numbers().private_value.to_bytes(32, "big")
   public_key = key.public_key.public_bytes(
       serialization.Encoding.X962,
       serialization.PublicFormat.UncompressedPoint,
   )
   print("WEB_PUSH_VAPID_PUBLIC_KEY=" + base64.urlsafe_b64encode(public_key).decode().rstrip("="))
   print("WEB_PUSH_VAPID_PRIVATE_KEY=" + base64.urlsafe_b64encode(private_key).decode().rstrip("="))
   print("WEB_PUSH_VAPID_SUBJECT=mailto:seu-email-administrativo@exemplo.com")
   ```

   Cadastre os três valores no Render; mantenha a chave privada fora do repositório. Após configurar as variáveis, faça o deploy da API.
5. Em **Configurações**, o administrador conecta a conta Google. O sistema sincroniza o quadro de avisos, próximas revisões e pedidos em aberto. Eventos e revisões recebem alertas por e-mail e pop-up um dia antes e no dia, às 9h; pedidos ainda pendentes recebem lembretes diários às 9h a partir do dia seguinte ao cadastro. Pedidos entregues, retirados ou cancelados deixam de ser sincronizados como pendentes.
6. Cada usuário ativa **Notificações neste navegador** em Configurações, permitindo as notificações do sistema operacional. A permissão é específica por navegador/dispositivo.

A sincronização do Agenda se repete a cada cinco minutos enquanto a API está ativa; também é possível sincronizar manualmente. Como este Blueprint usa o plano gratuito do Render, a API pode suspender-se sem tráfego. Nesse caso, a sincronização e o Web Push podem atrasar até a API voltar a executar. A entrega em segundo plano no horário exato exige um serviço sempre ativo ou um Cron/worker no Render, que pode ter custo adicional; a configuração atual não cria esse serviço.

### Backend local de testes

Os testes de integração usam uma API local e um banco MongoDB separado (`lokalmilitar_test`). Eles não devem ser executados contra produção.

1. Garanta que há um MongoDB local acessível em `127.0.0.1:27017`. Se ainda não houver um, inicie-o com `docker run --rm -d --name lokalmilitar-test-mongo -p 127.0.0.1:27017:27017 mongo:7`.
2. Instale as dependências do backend com `python -m pip install -r backend/requirements.txt`.
3. Execute `bash backend/tests/run_local.sh` na raiz do repositório. O script inicia a API apenas em `127.0.0.1`, usa o banco `lokalmilitar_test`, habilita acesso público só para a execução local e roda os testes em série.
4. Para encerrar o MongoDB iniciado pelo exemplo, execute `docker stop lokalmilitar-test-mongo`.

Se a porta MongoDB local padrão estiver ocupada por outro MongoDB local, use a porta em que ele está disponível: `TEST_MONGO_URL=mongodb://127.0.0.1:<PORTA> bash backend/tests/run_local.sh`. O script recusa conexões MongoDB não locais. O banco de teste fica separado e pode ser removido após conferir que `DB_NAME` é exatamente `lokalmilitar_test`.

Não publique segredos nem copie valores dos arquivos `.env` locais para o repositório; cadastre-os como variáveis seguras no serviço correspondente. O arquivo `frontend/.env.example` é apenas um exemplo, não uma configuração de produção.
