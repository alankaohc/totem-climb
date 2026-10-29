# 圖騰登頂

九尊圖騰搶第一的線上多人卡牌遊戲，2 到 4 人，可以加入電腦玩家。
伺服器用 Node.js + Express + Socket.IO，前端是純 HTML／CSS／JavaScript，不需要建置步驟。

## 本機執行

需要 Node.js 22。

```bash
npm install
npm start          # 打開 http://localhost:3000
npm test           # 規則引擎測試＋連線測試
```

## 部署到 Render

1. 把整個資料夾放到一個 GitHub repository（`node_modules` 不用上傳）。
2. 登入 Render，選 **New → Blueprint**，連結這個 repository。Render 會讀取 `render.yaml`，自動建立一個免費的 Node 網頁服務（新加坡機房，離台灣最近）。
3. 部署完成後會得到一個 `https://<服務名稱>.onrender.com` 網址，打開就能玩。

不想用 Blueprint 的話，也可以選 **New → Web Service**，手動填：

| 欄位 | 值 |
|---|---|
| Language | Node |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Instance Type | Free |
| Region | Singapore |
| Health Check Path | `/healthz` |

之後每次推送到 GitHub，Render 會自動重新部署。

### 免費方案要注意

- 閒置約 15 分鐘後服務會休眠，下一個人打開時要等將近一分鐘喚醒，畫面上會顯示「正在連線伺服器」。
- 房間存在伺服器記憶體裡。服務休眠、重新部署或重新啟動時，進行中的房間會消失，玩家會看到「房間不存在了」並回到首頁。

## 怎麼玩

1. 輸入暱稱，按「建立房間」。
2. 把 4 個字母的房間代碼或邀請連結傳給朋友；人不夠可以加入電腦玩家。
3. 房主按「開始遊戲」。

重新整理頁面或短暫斷線都會自動回到原本的房間。輪到斷線的玩家時，30 秒後由電腦代打；遊戲中按「離開」，你的位置會交給電腦繼續打。

## 規則設定與假設

規則都在 `server/` 裡，改一處就會全部生效：

- `server/cards.js`
  - `BASE_HAND`：每人手牌。目前假設是「上升 1 ×2、上升 2、上升 3、推到底、燒毀 ×2」共 7 張，三、四人時拿掉一張上升 1。若和實體遊戲不同，改這一行即可。
  - `TARGET_CARDS`：27 張目標卡。這是依據公開資訊重建的平衡版本（每尊圖騰在 9 分、5 分、2 分位置各出現 3 次），不是官方清單；拿到實際卡片後可以直接替換。
  - 變體規則：加入「交換」「下降 2」，每人洗牌後隨機移除兩張。「下降 2」和上升一樣必須走滿格數。
- `server/game.js`：出牌、計分、局數、同分加賽。
- `server/bot.js`：電腦玩家的判斷方式。

## 動畫速度

- 每一步的動畫長度在 `public/app.js` 最上面的 `MOVE_MS`（目前 3000 毫秒）。被移動的圖騰會沿弧線繞過其他圖騰，右側畫出軌跡；燒毀的圖騰會先閃火光，再飛進「已燒毀」區。
- 電腦玩家出牌前等待的時間在 `server/index.js` 的 `BOT_DELAY_MS`（目前 4500 毫秒），要比動畫長，大家才有時間看清楚。調整 `MOVE_MS` 時記得一起改。
- 系統設定「減少動態效果」的玩家不會看到動畫，但軌跡仍會畫出來。

## 專案結構

```
server/index.js   伺服器、房間、連線與重新連線
server/game.js    規則引擎（純函式，方便測試）
server/bot.js     電腦玩家
server/cards.js   圖騰、目標卡、手牌資料
public/           前端頁面
test/             自動測試
render.yaml       Render 部署設定
```

## 名稱與美術

遊戲名稱、圖騰名稱和圖像都是原創的，沒有使用原版的商標或美術。
