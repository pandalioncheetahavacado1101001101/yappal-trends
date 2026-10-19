# Embedding probe

2026-10-19T18:05:14Z. Runner: 4 cores, 15990 MB. 2000 invented headlines. Install: 57 s.

Budget 30 s a collect cycle; texts a cycle: typical 300, busy 1000, cold 27000; cache restore assumed at 100 MB/s.

| model | MB | pull s | load s | dims | best texts/s (batch) | Ollama peak MB | cycle s typical / busy / cold | verdict | story over person AUC | cut | person centroids p90 / max |
|---|---|---|---|---|---|---|---|---|---|---|---|
| nomic-embed-text | 262 | 3.87 | 0.31 | 768 | 25.7 (256) | 65 | 14.6 / 41.8 / 1053.5 | collect | 0.9 | 0.81 | 0.912 / 0.927 |
| all-minilm | 44 | 2.66 | 0.27 | 384 | 159 (256) | 65 | 2.6 / 7 / 170.5 | collect | 0.872 | 0.55 | 0.756 / 0.789 |

| model | batch | s | texts/s | Ollama peak MB | least available MB |
|---|---|---|---|---|---|
| nomic-embed-text | 16 | 78.23 | 25.6 | 46 | 14608 |
| nomic-embed-text | 64 | 77.99 | 25.6 | 52 | 14637 |
| nomic-embed-text | 256 | 77.89 | 25.7 | 65 | 14594 |
| all-minilm | 16 | 12.87 | 155.4 | 59 | 14805 |
| all-minilm | 64 | 12.97 | 154.2 | 62 | 14812 |
| all-minilm | 256 | 12.58 | 159 | 65 | 14799 |

| model | pairs: one story p10 / p50 | one person, two stories p50 / p90 | same kind, two people p50 / p90 | unrelated p50 / p90 | AUC over kind / unrelated |
|---|---|---|---|---|---|
| nomic-embed-text | 0.784 / 0.853 | 0.769 / 0.817 | 0.742 / 0.808 | 0.675 / 0.726 | 0.93 / 0.996 |
| nomic-embed-text at 256 | 0.799 / 0.864 | 0.785 / 0.834 | 0.761 / 0.824 | 0.697 / 0.752 | 0.924 / 0.994 |
| all-minilm | 0.462 / 0.635 | 0.444 / 0.574 | 0.313 / 0.479 | 0.175 / 0.303 | 0.955 / 0.997 |
| all-minilm at 256 | 0.468 / 0.645 | 0.459 / 0.586 | 0.323 / 0.488 | 0.192 / 0.327 | 0.951 / 0.995 |
