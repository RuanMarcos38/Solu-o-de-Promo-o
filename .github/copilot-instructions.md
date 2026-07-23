# Regras obrigatórias do projeto

## Fluxo GitHub

- Nunca enviar alterações diretamente para `main`.
- Criar uma branch de trabalho, realizar commits descritivos e abrir Pull Request.
- Executar build, lint e validações disponíveis antes do merge.
- Somente integrar na `main` após o PR estar validado.
- Não apagar arquivos, integrações, segredos, banco, Redis, volumes ou configurações de deploy sem necessidade explícita.

## Preservação da interface

- Preservar o layout, posicionamento, tamanho, espaçamento, responsividade, animações e interações existentes.
- Não permitir elementos sobrepostos, cortados ou cobrindo botões, textos, menus e formulários.
- Toda alteração visual deve funcionar em desktop, tablet e celular.

## Hero com vídeo

- O vídeo oficial deve permanecer em `apps/web/public/media/hero-background.mp4`.
- O poster/fallback oficial deve permanecer em `apps/web/public/media/hero-poster.jpg`.
- O vídeo deve usar autoplay, loop, muted, playsinline e não pode exibir controles.
- O vídeo deve usar `object-fit: cover`, sem distorções e sem barras.
- O vídeo deve ficar atrás de todos os componentes da Hero.
- Todo o conteúdo interativo deve permanecer no primeiro plano.
- A camada de vídeo deve usar `pointer-events: none`.
- Manter overlay escuro entre 40% e 60% para legibilidade.
- Exibir poster ou fallback enquanto o vídeo estiver carregando ou se houver erro.
- Não substituir o vídeo de background por player incorporado.
- Não remover nem alterar a identidade visual do arquivo de referência.
- Otimizar a mídia para web, sem áudio e com carregamento progressivo.

## Regra de segurança para futuras alterações

Qualquer agente, automação ou desenvolvedor que modificar a Hero deve validar que campos, botões, menu, logo, textos e demais controles continuam clicáveis, visíveis e acima do vídeo em todas as resoluções.