# Keyless source probe

Ran 2026-10-11T19:34:40.899Z from a GitHub Actions runner (Node v26.11.1). 38 of 40 answered with the structure expected.
One GET each, an honest user agent, 15 seconds at most. The check is a count or a yes/no: no content is kept.

| # | source | rank | gap | status | bytes | type | ms | as expected | check |
|---|---|---|---|---|---|---|---|---|---|
| 1 | google-complete-wildcard | 1 | 1,4 | 200 | 979 | text/javascript | 197 | yes | completions: 15 |
| 2 | youtube-channel-feed | 2 | 1,3 | 200 | 20011 | text/xml | 27 | yes | entries: 15, with view counts: 15 |
| 3 | wikipedia-hourly-dumps-index | 3 | 3 | 200 | 68555 | text/html | 112 | yes | hourly files listed: 257, newest is 4 h old |
| 4 | trendingtiktoksongs-viral-us | 4 | 2,3 | 200 | 754971 | text/html | 295 | yes | chart rows: 50 |
| 5 | wiktionary-internet-slang | 5 | 4 | 200 | 2697 | application/json | 159 | yes | members: 40 |
| 6 | google-complete-shopping | 6 | 5 | 200 | 891 | text/javascript | 61 | yes | completions: 15 |
| 7 | livestreamfails-hot | 7 | 1,6 | 200 | 20237 | application/json | 417 | yes | clips: 20, with a score: 20 |
| 8 | arctic-shift-comments | 8 | 6,1 | 200 | 5010 | application/json | 1645 | yes | comments: 100, threads: 18 |
| 9 | arctic-shift-posts | 8 | 6,1 | 200 | 4250 | application/json | 1537 | yes | posts: 25 |
| 10 | famous-birthdays-trending | 9 | 1 | 200 | 97837 | text/html | 258 | yes | people with a rank move: 48 |
| 11 | sportskeeda-news-sitemap | 10 | 1 | 403 | 1880 | text/html | 395 | NO | not read (HTTP 403) |
| 12 | ivr-twitch-users | 11 | 1,3 | 200 | 6055 | application/json | 664 | yes | users: 4, with a follower count: 4 |
| 13 | roblox-explore | 12 | 5,3 | 200 | 154660 | application/json | 223 | yes | sorts: 6, games: 446 |
| 14 | pagesix-news-sitemap | 13 | 3,1 | 200 | 33732 | application/xml | 75 | yes | urls parsed: 54 |
| 15 | ladbible-googlenews | 13 | 1,3 | 200 | 41182 | application/xml | 159 | yes | urls parsed: 47 |
| 16 | complex-news-sitemap | 13 | 1,3 | 200 | 103638 | application/xml | 276 | yes | urls parsed: 108 |
| 17 | shaderoom-feed | 14 | 1 | 200 | 167804 | application/rss+xml | 120 | yes | items parsed: 10 |
| 18 | hotnewhiphop-feed | 14 | 1 | 200 | 63100 | text/plain | 464 | yes | items parsed: 10 |
| 19 | ontd-rss | 14 | 1,6 | 200 | 95502 | text/xml | 1680 | yes | items: 25, with a reply count: 25 |
| 20 | apple-top-free-apps | 15 | 5 | 200 | 25798 | application/json | 682 | yes | apps: 50 |
| 21 | gdelt-ngrams-toc | 16 | 3 | 200 | 276456 | application/json | 221 | yes | articles: 1956 |
| 22 | creatordb-instagram-audio | 17 | 2 | 200 | 71354 | text/html | 266 | yes | chart rows: 14, audio ids: 11 |
| 23 | later-tiktok-trends | 18 | 2 | 200 | 994647 | text/html | 255 | yes | trend entries: 60, sound links: 46 |
| 24 | ramdam-tiktok-trends | 18 | 2 | 200 | 168532 | text/html | 237 | yes | tiktok links: 23 |
| 25 | youtube-results-today (owner's switch) | 19 | 1,3 | 200 | 1185606 | text/html | 336 | yes | videos parsed: 20 |
| 26 | creatordb-youtube-trending | 20 | 1 | 200 | 177501 | text/html | 369 | yes | video ids: 20 |
| 27 | creatordb-controversy | 20 | 1 | 200 | 169651 | text/html | 3495 | yes | video ids: 75 |
| 28 | shazam-discovery-csv | 21 | 2 | 200 | 481 | text/csv | 244 | yes | rows: 10 |
| 29 | steam-concurrent-players | 22 | 3 | 200 | 7612 | application/json | 99 | yes | ranks: 100 |
| 30 | kworb-spotify-us-daily | 23 | 3,2 | 200 | 86400 | text/html | 550 | yes | rows: 200 |
| 31 | sullygnome-follower-losers | 24 | 1 | 200 | 19781 | application/json | 1040 | yes | rows: 25, with a follower change: 25 |
| 32 | afterschool-feed | 25 | 4,5 | 403 | 5627 | text/html | 35 | NO | cloudflare challenge (not read (HTTP 403)) |
| 33 | bing-completions | 26 | 4,1 | 200 | 918 | application/json | 61 | yes | completions: 25 |
| 34 | streamerbans-feed | 27 | 1 | 200 | 101714 | text/html | 1563 | yes | ban events: 8 |
| 35 | bing-news-rss | 28 | 1,3 | 200 | 11483 | application/xml | 248 | yes | items parsed: 12 |
| 36 | pinterest-trends | 29 | 5 | 200 | 13476 | application/json | 221 | yes | terms: 50 |
| 37 | revid-tiktok-today | 30 | 2 | 200 | 567736 | text/html | 295 | yes | gaining posts: 12 |
| 38 | youtube-hashtag-page | 31 | 4,3 | 200 | 885587 | text/html | 564 | yes | has the videos-and-channels line: yes |
| 39 | tiktok-embed-sound (owner's switch) | 32 | 2,3 | 200 | 280659 | text/html | 663 | yes | has a video count: yes |
| 40 | tiktok-profile-page (owner's switch) | 33 | 1,2 | 200 | 387571 | text/html | 372 | yes | has an exact follower count: yes |
