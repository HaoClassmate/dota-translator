# 远程接收 + 中文实时网页

游戏电脑只放一个 GSI 配置文件，Dota 把聊天推到服务器，服务器翻成中文，网页实时显示。

## 服务器

```
GSI_TOKEN=<随机口令> LLM_API_KEY=<key> node server/index.js
```

环境变量：`PORT`(47854) `HOST`(0.0.0.0) `LLM_API_URL`(DeepSeek，任意 OpenAI 兼容接口) `LLM_MODEL`(deepseek-chat) `PROMPT_FILE`(提示词文件，改了即生效，不用重启)。

线上（wanghaodev）：systemd `dota-chat`，配置 `/etc/dota-chat.env`，提示词 `/etc/dota-chat.prompt`，只听 127.0.0.1。
前面是 Caddy（`/etc/caddy/Caddyfile`），再前面是 Cloudflare 代理（SSL Full，源站自签证书）。

网页：`https://dota.wanghaos.com/?k=<GSI_TOKEN>`。自己发的消息也翻译，标"我"。

## 游戏电脑

把下面内容存成
`Steam\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\gamestate_integration_remote.cfg`，然后重启 Dota：

```
"Remote chat"
{
    "uri"           "http://dota.wanghaos.com/"
    "timeout"       "5.0"
    "buffer"        "0.1"
    "throttle"      "0.1"
    "heartbeat"     "10.0"
    "auth"
    {
        "token"     "<GSI_TOKEN>"
    }
    "data"
    {
        "provider"  "1"
        "map"       "1"
        "player"    "1"
        "hero"      "1"
        "events"    "1"
    }
}
```

本地测试：`node server/fakegsi.mjs http://127.0.0.1:47854/ <token> "ss mid b" "bobo ka"`

## 调提示词

默认提示词在 `server/prompt.txt`；线上读 `/etc/dota-chat.prompt`，改了下一条就生效。翻译时会带上同一局最近 8 条聊天作上下文。
改之前先用真实对局记录对比新旧译文：

```
cd /opt/dota-chat && set -a && . /etc/dota-chat.env && set +a
node server/retranslate.mjs /var/lib/dota-chat/lines.json --prompt /path/to/new-prompt.txt --match <比赛编号>
node server/retranslate.mjs /var/lib/dota-chat/lines.json --prompt /path/to/new-prompt.txt "torm" "xd"
```

