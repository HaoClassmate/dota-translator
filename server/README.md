# 远程接收 + 中文实时网页

游戏电脑只放一个 GSI 配置文件，Dota 把聊天推到服务器，服务器翻成中文，网页实时显示。

## 服务器

```
GSI_TOKEN=<随机口令> LLM_API_KEY=<key> node server/index.js
```

环境变量：`PORT`(47854) `HOST`(0.0.0.0) `LLM_API_URL`(DeepSeek，任意 OpenAI 兼容接口) `LLM_MODEL`(deepseek-chat)。
线上用 systemd：`/etc/systemd/system/dota-chat.service`，配置在 `/etc/dota-chat.env`。

网页：`http://<域名>:47854/?k=<GSI_TOKEN>`

## 游戏电脑

把下面内容存成
`Steam\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\gamestate_integration_remote.cfg`，然后重启 Dota：

```
"Remote chat"
{
    "uri"           "http://<域名>:47854/"
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
