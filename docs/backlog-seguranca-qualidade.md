# Backlog de seguranca e qualidade — PingPong PaiD'egua

Origem: aprendizado do caso Mayumi aplicado ao fluxo FloresTech.
Regra: lacuna conhecida de seguranca ou robustez e bug ate existir Spec de correcao ou decisao explicita de Leo.

## Pendencias ativas

| ID | Tipo | Severidade inicial | Lacuna | Evidencia atual | Criterio de fechamento |
|---|---|---|---|---|---|
| PP-SEC-001 | Bug de robustez | Medio | Review de codigo completo ainda pendente; reviews executados foram por diff/PR. | PP-006 corrigiu `publishMode` anonimo; auth admin e suite API passam, mas nao substituem pentest/review total. | Rodada OWASP A01-A10 sobre codigo atual, com achados classificados e Specs criadas para Medio+. |
| PP-SEC-002 | Bug de robustez | Medio | Scraping/HTTP externo precisa de allowlist e protecao SSRF revisada a cada mudanca. | Worker consome fontes CBTM e HTTP externo; superficie de URL deve permanecer controlada. | Teste ou checagem que bloqueie URL arbitraria/redirect perigoso quando a pipeline tocar fetch/scraping. |
| PP-SEC-003 | Bug de robustez | Medio | Tokens e segredos em GitHub Actions, logs, payloads e arquivos versionados. | Historico: token literal em `AGENTS.md` e token via `GITHUB_OUTPUT` em PP-017. | Security review manual do fluxo de segredo em todo workflow novo/alterado; scanner sozinho nao basta. |
| PP-SEC-004 | Bug de robustez | Baixo | XSS/exposicao por dados CBTM renderizados no frontend publico. | Dados externos sao exibidos no Next.js; React escapa por padrao, mas excecoes futuras devem ser bloqueadas. | Toda mudanca com HTML/markdown/dangerous rendering precisa teste/inspecao contra payload malicioso. |

## Regra para novas Specs

Toda Spec que tocar admin API, auth, worker, scraping, workflow, env, cache interno ou renderizacao de dado externo deve incluir security surface explicita e T-* de comportamento proibido.
