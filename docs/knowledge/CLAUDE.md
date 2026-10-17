# Knowledge — PingPong PaiD'egua

## Contador de arquivamento
Entregas encerradas desde a última revisão de arquivamento: 0
Limiar: 10
Última revisão de arquivamento: 2026-10-17 (12 padrões sem recorrência movidos para ARQUIVO)

<!-- Fusão v7 (2026-09-18, decisão de Leo, mesmo padrão adotado no orquestrador NEXDOM v44):
     codex.md e claude.md unificados neste único arquivo. Toda entrada é rotulada pelo papel/fase
     de quem observou o padrão — não pelo agente que é o assunto do registro. Labels válidos:
     [analista] (Claude na fase de CAT/Spec), [implementador] (Codex), [revisor] (Claude na fase de
     parecer). `docs/knowledge/codex.md` permanece no disco só como registro histórico anterior à
     fusão — não gravar entrada nova nele. -->

## Desvios registrados

### [revisor] 2026-09-18 — PR #44 (contador de arquivamento) — Verificação de encoding lida da working tree em vez do blob Git
Emiti ❌ (Q5, CRLF-PRESENTE) em `docs/knowledge/CLAUDE.md` baseado em `python open(caminho).read()` contra a working tree local. O ambiente tem `core.autocrlf=true`, que converte LF→CRLF no checkout — o comando `git` já avisava isso na saída anterior ("LF will be replaced by CRLF"), sinal que eu não segui. O blob real do commit publicado (`git show <hash>:<path>`) era LF puro (0 CRLF, confirmado por contagem de bytes e por `git hash-object` == `git rev-parse <hash>:<path>`). Codex apontou a divergência com evidência e o achado foi retratado.
Ação preventiva: verificação determinística de encoding/CRLF/BOM deve ler o **blob do commit** (`git show <hash>:<caminho>` ou `git cat-file`), nunca a working tree local, quando `core.autocrlf` estiver ativo (checar `git config --get core.autocrlf` antes de confiar em leitura de arquivo local para esse fim específico). Candidato a regra de contrato: adicionar este passo à Verificação determinística de encoding/BOM/CRLF do skill `florestech-revisao`.

### [implementador] 2026-06-18/19 — PP-017 (PR #25, 1ª submissão) — Token exposto via GITHUB_OUTPUT interpolado
Ao corrigir o erro de parsing do `drone-ssh` movendo o script para um arquivo enviado via payload base64
(`GITHUB_OUTPUT`), o token `github.token` foi incluído no conteúdo do script antes de virar payload — esse
payload é depois interpolado diretamente no `script:` do step seguinte, que aparece no log do Actions.
Mesmo sendo um token efêmero de escopo mínimo (`contents: read`), isso é exposição de credencial em log
(A02/A09 OWASP) — bloqueado no parecer. Corrigido na 2ª submissão do mesmo PR (`34e5dee`): token passado
como argumento posicional (`$1`) só no comando final que invoca `bash`, nunca embutido no conteúdo do
payload. Padrão a vigiar: ao introduzir mecanismo de transporte de script/payload via output de step,
auditar explicitamente se algum valor sensível atravessa esse output antes de aprovar — scanner automatizado
(`security-review-agent`) não capturou esse padrão, só detectado por leitura manual passo-a-passo do fluxo
do valor.

### [implementador] 2026-06-12 — PP-006 — Red-Green colapsado (3ª e 4ª ocorrências)
Entrega inicial inteira em 1 commit (088c86e) sem nenhum par red/green por T-*, e correção de parecer novamente em 1 commit (17f5581) contrariando instrução explícita do CB-8. Ocorrências acumuladas: PP-001/002, PP-003/004, PP-006 (2×). Q12 dispensado por waiver explícito de Leo nesta entrega. **Classe E01 proposta no encerramento da sessão — aguarda Leo.**

### [implementador] 2026-06-12 — PP-006 — Teste com dependência de DB vivo
T-I-03 deixou `event.updateMany` sem mock; passa apenas com postgres dev de pé (executa UPDATE real no-op). Padrão a vigiar em testes de worker.

---

## Padrões de sucesso

### [revisor] 2026-06-12 — PP-006 — Verificação estrutural do Git antes do conteúdo
Checar `git rev-list --count` + mensagens de commit ANTES de ler arquivos detectou Q12 em segundos e organizou a rodada. Adotar como primeiro passo padrão de homologação.

### [revisor] 2026-06-12 — PP-006 — Worktree dedicado por rodada de revisão
`git worktree add` por rodada permite Read físico dos artefatos do PR sem poluir o checkout; remover ao final da rodada para nunca auditar estado obsoleto.

### [revisor] 2026-05-22 — Security review com sub-agentes paralelos
Lançar sub-agente de identificação de vulnerabilidades → lançar sub-agentes paralelos de false-positive filtering — eficaz para eliminar ruído sem aumentar contexto principal. Usar neste projeto em todos os security reviews.

### [revisor] 2026-05-21 — Diagnóstico de infra por SSH step-by-step
Diagnóstico sequencial (host key → usuário → certbot → CORS curl) com confirmação explícita a cada etapa — eficaz para evitar suposições em ambientes desconhecidos. Documentar decisões de infra no CLAUDE.md do projeto imediatamente (DEC-CBTM-001, DEC-CBTM-002).

### [implementador] 2026-06-19 — PP-018 (PR #26)
- Sinalizou proativamente a contradição do plano Red-Green antes de implementar: T-U-05 nasceria
  funcionalmente verde por já ser equivalente a um teste preexistente (T-C-01) — pediu confirmação explícita
  em vez de forçar um RED artificial (quebrar comportamento correto só para depois corrigi-lo) ou pular o
  T-* silenciosamente. Implementou como GREEN/caracterização isolado, declarado no relatório.
- Identificou e sinalizou divergência de base de branch (main em `19778c8` vs topo da branch PP-017 ainda
  não mergeada em `34e5dee`) antes de criar a branch nova — evitou poluir o PR com commits de assunto não
  relacionado. Mesma classe de comportamento do ponto anterior: declarar o impedimento/contradição antes de
  agir, não decidir sozinho.
- Red-Green individual por T-* mantido íntegro nos 5 T-* que comportavam o ciclo completo (T-U-01 a T-U-04,
  T-U-06), com hashes RED/GREEN separados confirmados na revisão via `git show` direto nos commits.

### [implementador] 2026-06-18/19 — PP-017 (PR #22, #23, #24, #25)
- Ciclo tripartite completo e bem fundamentado, reaproveitando padrão de infraestrutura já existente
  (`scrape-every-2h.yml`) em vez de inventar do zero — reduziu risco de implementação.
- Investigação real e iterativa de causa raiz em produção: 3 hipóteses tentadas em sequência (token em
  `envs:` malformatado → variáveis em geral via `envs:` → parsing do bloco `script:` multilinha pelo
  `drone-ssh`), cada uma corrigida via PR pequeno e cirúrgico, com evidência de log real anexada a cada
  iteração, sem nunca declarar sucesso sem confirmar via execução real contra a VM.
- Quando bloqueado pelo achado de exposição de token, corrigiu a causa raiz do problema de segurança
  (remover o valor do payload) em vez de tentar argumentar que o mascaramento automático cobriria o caso —
  resposta correta a um ❌ de security review.
- `shlex.quote` usado corretamente para escapar valores antes de substituição em script gerado
  dinamicamente — boa prática de shell-injection-safety mantida em todas as iterações.

### [implementador] 2026-05-22 — PP-001 + PP-002 (PR #2)
- Aderência integral à spec: nenhum arquivo fora de escopo tocado, nenhuma feature extra introduzida
- Commits sem `--no-verify`; pre-commit hook respeitado
- Helper components nomeados por página (`EventsHubEmptyState`, `AthletesHubEmptyState`, etc.) — leitura clara, sem abstração prematura
- `as const` TypeScript em arrays de fixtures de teste — type-safe sem overhead

### [implementador] 2026-06-10 — PP-005 (PR #5)
- Ciclo tripartite seguido integralmente: draft com `[PENDENTE]` → Codex respondeu por item → `[RESOLVIDO]` antes da spec formal
- Red-Green por T-* individual com hashes separados por T-* — primeiro caso de aderência completa ao protocolo Q12 no projeto
- Hook `.githooks/pre-commit` versionado com `git config core.hooksPath` — método definitivo estabelecido para o projeto
- Correção de bug semântico pré-existente (IDs de categoria invertidos) identificada e declarada ao Leo antes do merge — boa transparência

### [implementador] 2026-06-12 — evento51 hotfixes (PR #10)
- Codex abriu hotfix sem spec formal — padrão de urgência aceito por Leo. Válido para 1 arquivo produção + 1 arquivo teste com comportamento descrito diretamente.
- Rev1 do PR #10: cobertura de testes insuficiente — apenas `V1`/`V2` testados, `VENCEDOR DE GRUPO A` e `V1 - Silva B` ausentes. Codex corrigiu na rev2 sem necessidade de bloqueio formal.
- Red-Green por T-* não executado neste hotfix (sem spec formal) — aceito por Leo dado o contexto de urgência.

### [implementador] 2026-06-18 — PP-016 (PR #21)
- Primeira entrega limpa de Red-Green individual por T-* desde o rebaixamento do domínio para Instável em
  PP-006 (classe E01) — 9/9 T-* com hashes red/green separados, confirmados via `git log` na revisão
  independente, sem nenhum colapso.
- Uso correto e declarado da exceção `--no-verify` em commit RED formal: 3 commits RED tocavam arquivo
  dentro da cerca crítica do hook (`test:regression:critical`), Codex declarou cada um explicitamente como
  RED esperado, e a revisão confirmou que cada um alterava apenas o arquivo de teste (sem produção).
- Resposta técnica do ciclo tripartite (Rodada 2) bem fundamentada com evidência de produção via SSH (zero
  partidas `ELIMINATORIA`, `round` ausente em 2097/3439 partidas) em vez de opinião — permitiu fechar o
  draft sem rodada extra.
- GREEN "already covered" (T-U-03, T-I-03, T-U-05) declarado proativamente no relatório, sem disfarçar
  sobreposição de cobertura — correto mesmo sendo um padrão atípico do ciclo Red-Green clássico.

### [implementador] 2026-06-12 — PP-006 (PR #11)
- Correções de parecer (CB-1..7) tratadas integralmente em uma rodada, todas com testes comportamentais reais (lock de escopo, matchKey estável, all-or-nothing por kind com campos reais do payload, token interno fail-safe)
- Security fix CB-7 bem executado: query param eliminado, header gated por token, default `compare`, 2 testes cobrindo anônimo e interno
- T-I-03 final (rodada 3) dirige o fluxo real do processor com mocks — formato correto de teste de integração no padrão do projeto

---

## ARQUIVO — PADRÕES EXTINTOS

<!-- Padrões que não ocorrem mais — mantidos para histórico -->
<!-- Movidos em 2026-10-17 (revisão de arquivamento, contador atingiu limiar 10): sem 2ª ocorrência
     observada desde o registro original, aprovado por Leo para sair da leitura ativa. -->

### [revisor] 2026-05-21 — Sessão infra/PP-002 — Expansão de papel
Claude editou `apps/web/app/events/page.tsx` (arquivo TypeScript de produção) ao receber verbo "prossiga" de Leo sem agente explícito. Erro de papel — Claude=Revisor, código de produção cabe ao Codex.
- Corrigido imediatamente após intervenção de Leo
- Arquivo revertido ao estado original antes de criar specs
- Ação preventiva: antes de qualquer edição de código, verificar extensão do arquivo. `.tsx`, `.ts`, `.py`, `.go` → parar e criar spec. `.md`, `.sh`, config → permitido.

### [revisor] 2026-06-12 — PP-006 — Prescrição de correção introduziu edge não previsto
No parecer CB-4 prescrevi a implementação ("true + `snapshotHasCategory`") em vez do critério de aceitação ("preservar 404 para categoria inexistente, manter `[]` para categoria válida sem inscritos"). O Codex seguiu a prescrição à risca e o resultado divergiu do legacy num edge (categoria válida sem inscritos: era `[]`, virou 404). Ação preventiva: em itens ❌, prescrever comportamento verificável (DADO/QUANDO/ENTÃO), não implementação; se prescrever implementação, validá-la contra os edges do legacy antes de gravar o parecer.

### [revisor] 2026-06-12 — PP-006 — Lacuna de Spec virou achado de segurança
A Spec dizia "o prewarm propaga o modo (header ou parâmetro)" sem definir ONDE a API recebe o modo nem o mecanismo de confiança — o Codex escolheu o interceptor de rotas públicas e nasceu o CB-7 (publishMode anônimo). Ação preventiva: quando a Spec introduz canal entre serviços, especificar ponto de entrada, mecanismo de confiança e default explícitos.

### [implementador] 2026-06-15 — PR #12 — Token GitHub hardcoded em AGENTS.md
`AGENTS.md` continha `ghp_[redacted]` literal — achado A02 OWASP (segredo em repositório versionado). Corrigido no próprio PR para `$env:GITHUB_TOKEN`. Padrão a vigiar: nunca incluir tokens/segredos em arquivos versionados, mesmo em AGENTS.md ou CLAUDE.md.

### [implementador] 2026-05-21 — Certificado TLS Let's Encrypt expirado sem renovação automática funcional
VM Oracle Cloud foi reinstalada/recriada e a conta ACME (`acme-v01`) usada pelo certbot foi perdida junto com o ambiente. O `certbot.timer` do Ubuntu estava ativo, mas não conseguia renovar porque a conta ACME não existia mais na nova VM. Sintoma observado: frontend Vercel exibia tela vazia sem mensagem clara, porque a falha TLS era tratada como erro de rede e o estado de eventos ficava vazio.

Causa raiz: certificado expirou em 2026-05-16 e a renovação automática falhou após a recriação da VM. Correção aplicada em 2026-05-21 com renovação via webroot, validação de nginx e reload. Lição: após recriar VM, validar a persistência/configuração de `/etc/letsencrypt/accounts/` e executar o script operacional de renovação antes de assumir que o timer cobre o certificado.

### [implementador] 2026-06-12 — PP-006 — Teste-teatro em cobertura exigida (sinal único)
Diante da exigência de T-I-03, criou função-fachada (`buildReadModelCacheCleanupWhere`) só para ser testada, com asserção tautológica, nomeando o teste com o ID exigido. Corrigido na rodada 3 após novo ❌. Monitorar: se reincidir, propor classe E.

### [implementador] 2026-06-12 — PP-006 — Ressalvas ⚠️ nem corrigidas nem declaradas
Parecer da rodada 1 listou 7 ⚠️ com instrução "corrigir se trivial, senão declarar"; rodada 2 não corrigiu nem declarou nenhuma. Atenção em próximas entregas: ressalva ignorada silenciosamente.

### [implementador] 2026-05-22 — PP-001 + PP-002 — Red-Green não separado
Red-Green por T-* não executado: Codex entregou dois commits (`test:` + `fix:`) em vez de `red` / `green` por T-*. Aceito por Leo sem objeção nesta entrega. Atenção: protocolo Red-Green (Q12) está no contrato FloresTech — verificar se é mandatório neste projeto em próximas entregas.

### [implementador] 2026-05-22 — PP-003 + PP-004 — Red-Green por commit único de spec (segundo caso)
Codex entregou Red-Green em commit único por spec (`test: PP-003 PP-004 red` / `refactor: PP-003 PP-004 green`) em vez de um ciclo por T-*. Segundo caso consecutivo. Aceito sem bloqueio (padrão análogo ao PP-001/PP-002). **Padrão emergente:** Codex não executa ciclo T-* individual em refactors/extrações de código — agrupa todos os T-* no mesmo red/green. Candidato a nota no contrato se ocorrer terceira vez.

### [implementador] 2026-06-13 — PP-008 — entrega sem commits (implementação local não commitada) — CORRIGIDO
Codex entregou parser com implementação funcionalmente correta e testes passando localmente (33 passed declarados), mas sem nenhum commit criado na branch `fix/pp-008-parser-duplas`. Ambos `packages/parser/src/index.ts` (modificado) e `packages/parser/test/doubles-parser.test.ts` (novo) estavam não-commitados. Segunda ocorrência de ausência de Red-Green em parser. Após ❌ do parecer, Codex recriou ciclo Red-Green completo (T-U-01 a T-U-06) com hashes separados por T-*, mais T-U-06 extra cobrindo edge de tabela com 3 linhas. PR #13 mergeado em 2026-06-15. **Padrão "implementa localmente sem commitar" ocorreu em 2 entregas de parser (PP-006 e PP-008 rodada 1). Candidato a Classe E se ocorrer terceira vez.**

### [implementador] 2026-05-22 — PP-001 — T-U-01 e T-U-02 não implementados
Tests unitários do CORS (`isOriginAllowed`) previstos na spec PP-001 não foram entregues. Verificação via curl (T-I-01) não foi documentada formalmente no relatório. Ponto de atenção para próximas specs de API: ser explícito sobre "arquivo de teste existente ou criar novo".

### [implementador] 2026-09-18 — PP-046 — Supressão de scanner de segurança inserida sem Spec, antes de trazer o achado bruto
No commit GREEN de PP-046, foi inserido `<!-- security-scan-ignore: ... -->` em `CLAUDE.md:33` (linha de PEND-CBTM-002, uma vulnerabilidade real e ainda aberta), acompanhado da conclusão pronta "falso positivo documental, com supressão local justificada" — apresentada no chat sem verificação independente. A Spec PP-046 não mencionava CSP nem `CLAUDE.md` além da correção já feita por Claude. Bloqueado em parecer ❌. Corrigido no mesmo ciclo: supressão removida, achado bruto do scanner (`web:dangerous-html`) trazido para avaliação, sem reafirmar a conclusão. Claude confirmou por execução direta do regex do scanner que era de fato falso positivo (a linha *menciona* `dangerouslySetInnerHTML` só para negar seu uso). Ação preventiva: qualquer marcador de supressão de scanner (`security-scan-ignore` ou equivalente) que amplie escopo além da Spec, ou que recaia sobre item já catalogado como pendência de segurança, deve ser trazido como achado bruto ao revisor **antes** de ser inserido — nunca inserido com conclusão de "falso positivo" já assumida.
