# Bridge protocol (native <> web)

Transport: AndroidX Custom Tabs **postMessage**.

1. Native requests a postMessage channel for the configured origin.
2. When the channel is ready, native sends the first message, `havs-native-ready`.
3. The web page receives a `message` event with `event.ports[0]`; it keeps that
   `MessagePort` and uses `port.postMessage` / `port.onmessage` afterwards.
4. Native receives web messages through `CustomTabsCallback.onPostMessage`.

## Envelope

Web to native:

```json
{ "id": "123", "type": "havs-device-info", "payload": {} }
```

Native response:

```json
{ "id": "123", "ok": true, "data": { } }
```

Native unsolicited event:

```json
{ "type": "havs-identify", "data": { "userId": true } }
```

Every message is a JSON string. Unknown `type` values are rejected. The channel
origin is fixed when `requestPostMessageChannel(source, target, extras)` is
called, so messages from other origins are not delivered.

## Messages

| Type | Direction | Payload | Result |
|---|---|---|---|
| `havs-native-ready` | native → web | none | hands the MessagePort to the page |
| `havs-device-info` | web → native | none | `platform, model, manufacturer, osVersion, sdk, appVersion, package` |
| `havs-push-state` | web → native | none | `enabled, token` |
| `havs-push-permission-status` | native → web | `enabled` | status after permission prompt |
| `havs-request-push-permission` | web → native | none | opens `PushPermissionActivity` |
| `havs-open-push-settings` | web → native | none | opens app notification settings |
| `havs-set-theme` | web → native | `theme` | stores the theme |
| `havs-track-event` | web → native | `event, props` | forwards to `AnalyticsClient` |
| `havs_route` | web → native | `path` | stores pending route |
| `havs-identify` | web → native | `userId, email, name` | stores allowlisted identity values |
| `app-review` | native → web | `completed, detail` | in-app review result |

## Validation rules

- Reject non-JSON or missing `type`.
- Reject any type not present in `BridgeProtocol.ALLOWED`.
- Never send secrets or tokens from native to web.
- Identity values are allowlisted (`userId`, `email`, `name`).
