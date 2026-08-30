# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 1. Dự án này là gì

**Private Credential Lifecycle Engine** — một lớp *vòng đời credential* trên [Midnight](https://midnight.network), viết bằng Compact: cấp phát (issue), chứng minh không liên kết được (unlinkable presentation), thu hồi (revoke), hết hạn (expire).

**KYC chỉ là demo nằm trên, không phải phần đóng góp.** Đóng góp là lớp lifecycle bên dưới.

Ba điều phải luôn giữ trung thực khi viết code hay tài liệu trong repo này:

- **Issuer là mock.** Nó ký bất cứ giá trị thuộc tính nào được đưa cho, không xác minh danh tính gì cả. Không bao giờ viết câu nào ngụ ý repo này đảm bảo danh tính thật.
- **Đã deploy lên `preview`, chưa lên `preprod`.** Contract chạy thật tại `c301baf55617c5cb6dab9986e46eaf300561e7a156826eaa2fec4551a8333193` (block 647,605) — proof thật, phí DUST thật. Nhưng thứ được deploy là **bản port** trong `onchain/`, không phải bản tham chiếu; xem mục 7. Bản port **không verify chữ ký issuer** — nó dùng capability secret. Đừng viết câu nào gộp hai contract làm một.
- **Simulator vẫn là chế độ mặc định của demo.** `web/server.ts` chạy in-memory trừ khi bật chế độ on-chain. Ở chế độ đó không có ZK proof nào được sinh ra.
- UI báo **thời gian proving và tổng thời gian riêng biệt** khi chạy on-chain, và báo **thời gian thực thi circuit** khi chạy simulator — luôn ghi rõ đang là cái nào trên màn hình.

Repo có một văn hoá viết rất đặc trưng: **mọi tuyên bố phải có bằng chứng trong repo, mọi đánh đổi phải được ghi thẳng ra**. Xem [pitch/SELF-AUDIT.md](pitch/SELF-AUDIT.md) — tự chấm 7.76/10, không làm tròn lên. Giữ nguyên giọng văn này khi sửa README/DESIGN/RESEARCH.

---

## 2. Vấn đề giải quyết

Một người chứng minh "tôi trên 18 tuổi" cho 10 nền tảng hôm nay phải đưa 10 bản sao giấy tờ cho 10 database — mỗi cái là một vụ rò rỉ đang chờ xảy ra.

ZK proof giải quyết được **nửa vấn đề tiết lộ dữ liệu**. Nhưng hầu hết demo zk-KYC dừng ở `prove(age > 18)` — phần dễ. Phần khó là **ngày thứ hai**:

| Vấn đề ngày thứ hai | Cơ chế giải quyết trong repo |
|---|---|
| Credential cần thu hồi được | Active-set Merkle tree + tombstone leaf + `resetHistory()` |
| Credential cần hết hạn | So sánh `asOf < expiresAt` **trong circuit**; `expiresAt` không bao giờ ra public |
| Hai verifier không được biết họ phục vụ cùng một người | Nullifier riêng theo verifier: `H(secret, verifierId, epoch)` |
| Credential bị trộm phải vô dụng | Attestation ký lên `(commitment, holderId)`, `holderId = H(secret)` |
| Không được present lại nhiều lần | `spentNullifiers` map trên ledger |

Lớp lifecycle này là thứ mà Midnames (DID/naming), Identus (issuance/registry) và Triple Play (predicate circuits) **đều không cung cấp** — xem mục "Ecosystem context" trong [README.md](README.md).

---

## 3. Giải quyết bằng cách nào — ranh giới public/private

Toàn bộ thiết kế xoay quanh **một đường ranh giới**: cái gì lên ledger, cái gì ở lại máy holder. Compiler Compact cưỡng chế đường này qua phân tích `disclose()`; không phải quy ước lập trình.

```
   MOCK ISSUER              PUBLIC LEDGER (contracts/src/credential.compact)
   ┌────────────┐           ┌────────────────────────────────────────────┐
   │ jubjub sk  │──ký───────│ issuerKeys        Map<Uint16, JubjubPoint> │
   │ (không lên │attestation│ activeCredentials HistoricMerkleTree<10>   │
   │  chain)    │           │ spentNullifiers   Map<Bytes32, Boolean>    │
   └────────────┘           │ leafIssuer        Map<Uint64, Uint16>      │
                            │ revocationEpoch   Counter                  │
                            │ admin             sealed Bytes32           │
                            └────────────────────────────────────────────┘
                                   ▲                    ▲
                     commitment (hiding)         nullifier (một chiều)
 ══════════════════════════════════╪════════════════════╪══════════════════
        RANH GIỚI RIÊNG TƯ — disclose() là cửa duy nhất
                                   │                    │
                            HOLDER PRIVATE STATE (5 witness)
                            localSecret()  attributes()  blinding()
                            issuerSig()    merklePath()

                            birthTimestamp / countryCode / kycTier /
                            expiresAt — KHÔNG BAO GIỜ vượt qua đường này
```

### Bốn circuit

| Circuit | Ai gọi | Làm gì |
|---|---|---|
| `registerIssuer(issuerId, pubKey)` | admin | Ghi public key của issuer vào `issuerKeys` |
| `issueCredential(issuerId, commitment, holderId, leafIndex)` | issuer | Verify chữ ký issuer, chèn commitment vào Merkle tree, ghi quyền sở hữu slot vào `leafIssuer` |
| `revokeCredential(issuerId, leafIndex)` | issuer | Tombstone leaf, tăng `revocationEpoch`, gọi `resetHistory()` |
| `present(issuerId, verifierId, req, asOf)` | holder | Sáu kiểm tra dưới đây, trong **một** circuit |

### `present()` — sáu kiểm tra, không tiết lộ credential nào đang được dùng

Đọc [credential.compact:358](contracts/src/credential.compact#L358). Thứ tự và lý do:

1. **`asOf` phải tươi** — ghim vào `(blockTime − 5 phút, blockTime]`. Chặn holder chọn timestamp thuận lợi: quá xa về tương lai thì giả tuổi, quá xa về quá khứ thì hồi sinh credential đã hết hạn.
2. **Issuer được uỷ quyền đã attest commitment này** — public key đọc từ **ledger**, không phải từ prover (I6).
3. **Attestation gắn với đúng holder này** — ký lên `(commitment, holderId)`, nên credential trộm được là vô dụng (I7).
4. **Vẫn nằm trong active set** ⇒ chưa bị thu hồi. Merkle path bắt buộc thoả `path.leaf == commitment` (I2).
5. **Chưa hết hạn** — so sánh riêng tư, `expiresAt` không rò rỉ (I3).
6. **Predicate đúng**, và **nullifier chưa bị tiêu** trong epoch này (I4, I5).

### Ba quyết định chỉ có được khi thực sự đánh vật với dual-state model

Cần hiểu trước khi sửa contract — lập luận đầy đủ ở [DESIGN.md](DESIGN.md):

- **Gián tiếp qua `asOf`** thay vì `blockTimeLt(privateExpiry)` — vì cách sau **tiết lộ một cận trên của ngày hết hạn**, và compiler nói thẳng điều đó.
- **Đảo ngược thành active-set** thay vì revocation list — stdlib có membership proof nhưng **không có** primitive non-membership.
- **`resetHistory()` khi revoke là bắt buộc** — `HistoricMerkleTree.checkRoot` chấp nhận **bất kỳ root cũ nào**; thiếu dòng này thì I2 fail âm thầm, holder đã bị thu hồi vẫn present được bằng path cũ.

**Cái giá của quyết định thứ ba, phải nói rõ:** mỗi lần revoke làm **hỏng Merkle path đã cache của mọi holder**, không riêng người bị thu hồi. Tất cả phải refresh path. Đó là lý do UI có nút "refresh path", và là hành vi mà test thứ ba trong I2 ghim lại.

---

## 4. Kiến trúc mã nguồn

```
contracts/src/credential.compact   contract lifecycle (425 dòng) — nguồn chân lý
contracts/src/Predicates.compact   module predicate (90 dòng) — thêm predicate ở đây
core/engine.ts                     simulator + crypto mock issuer — DÙNG CHUNG cho tests, issuer, web
issuer/mockIssuer.ts               credential authority giả, được gắn nhãn rõ trong code
tests/                             54 test, mỗi invariant một file — xem tests/README.md
web/server.ts                      contract host (Express, :4000), giữ MỘT instance Sim trong RAM
web/src/                           React UI ba persona
onchain/                           bản port ĐANG CHẠY TRÊN PREVIEW — package riêng, xem mục 7
RESEARCH.md                        bề mặt API Compact đã kiểm chứng + §G phân tích khả năng deploy
DESIGN.md                          threat model, invariant, lựa chọn mật mã
pitch/                             kịch bản video, deck.html, self-audit
```

**`core/engine.ts` là trung tâm.** Nó được tách ra *chính xác để* tests, mock issuer và web dùng chung **một** simulator thay vì ba bản sao. Khi thêm hành vi mới, thêm vào `Sim` chứ đừng dựng lối gọi contract riêng.

API của `Sim` ([core/engine.ts:211](core/engine.ts#L211)):

```ts
Sim.deploy(adminSecret, startTime)     // in-memory ledger
sim.call(circuitId, privateState, ...) // gọi thô; lời gọi thất bại KHÔNG làm bẩn public state
sim.registerIssuer(adminSecret, issuer)
sim.issue(issuer, holder, atIndex?)    // ký + chèn + ghi lại sig/leafIndex vào holder
sim.revoke(issuer, leafIndex)
sim.path(commitment)                   // dựng Merkle path off-chain (findPathForLeaf)
sim.presentationState(holder, path?)   // lắp đủ 5 witness
sim.present(holder, issuer, verifierId, req, opts)
sim.advance(ms)                        // đẩy block time để test expiry
sim.ledger() / sim.rawState()          // rawState() là thứ test I1 quét
```

Chi tiết dễ vấp: `leafIndex` phải truyền **tường minh** cho `issueCredential`, vì Merkle tree ADT **không có** phép thử occupancy trong circuit. Đó cũng là lý do tồn tại `leafIssuer` map — nó vá ba lỗ hổng (revoke leaf rỗng = DoS miễn phí lên mọi holder; issuer A revoke credential của issuer B; ghi đè slot đang sống). Xem DESIGN.md §4.5.

**`web/server.ts` giữ trạng thái trong RAM.** Restart server là mất sạch; `POST /api/reset` dựng lại từ đầu. Routes:

```
GET  /api/state            toàn bộ trạng thái demo (public + private + lịch sử present)
POST /api/reset
POST /api/issuer/register   POST /api/issuer/issue   POST /api/issuer/revoke
POST /api/holder/refresh    dựng lại Merkle path sau khi tree thay đổi
POST /api/verifier/present
```

---

## 5. Luồng người dùng — ba persona

UI ([web/src/App.tsx](web/src/App.tsx)) chia theo ba vai, chuyển tab bằng `#issuer` / `#holder` / `#verifier`. Kịch bản demo đúng thứ tự:

### Tab Issuer — "Credential authority"
1. **Register issuer key** → `registerIssuer`. Public key lên ledger; secret key không bao giờ rời issuer.
2. **Issue credential**: nhập tên holder, tuổi, mã quốc gia, KYC tier, số ngày hiệu lực.
   Backend: dựng attributes → `persistentCommit(attrs, blinding)` → issuer ký `(commitment, holderId)` → `issueCredential` chèn vào tree.
   **Điều người xem cần thấy:** ledger chỉ nhận được một commitment 32 byte. Tuổi, quốc gia, tier không xuất hiện ở bất kỳ đâu.

### Tab Holder — "Wallet"
3. **Xem private register**: giá trị thuộc tính chỉ hiện ở panel private, đặt cạnh panel public để đối chiếu.
4. **Refresh path** khi path đã cũ (`pathFresh: false`) — trực quan hoá đúng cái giá của `resetHistory()`.

### Tab Verifier — "Relying party"
5. **Present cho Alpha Exchange** → nullifier #1, kết quả predicate, thời gian thực thi circuit.
6. **Present cho Beta Lending** với **cùng holder đó** → nullifier #2.
7. **Bài test liên kết**: so hai nullifier **từng byte một**, **0/32 byte trùng nhau**. Đây là khoảnh khắc chính của demo — I5.
8. **Present lại cùng verifier** → bị chặn: `nullifier already spent this epoch` (I4).

### Vòng khép lại
9. Quay lại Issuer → **Revoke** → sang Holder xem path chuyển stale → thử present lại → bị từ chối: `credential is not in the active set` (I2).

`scripts/demo-seed.sh` chạy đúng luồng này qua HTTP nếu cần dữ liệu dựng sẵn.

---

## 6. Lệnh thường dùng

> **Windows: toolchain Midnight không chạy native. Mọi thứ dưới đây phải chạy trong WSL2.**
> `node_modules` trong repo này được cài từ WSL (binary Linux) — chạy `npm test` từ phía Windows sẽ lỗi `Cannot find module @rollup/rollup-win32-x64-msvc`. Đó là hành vi mong đợi; đừng "sửa" bằng cách cài lại từ Windows.

```bash
# Toolchain (một lần)
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update 0.34.0
export PATH="$HOME/.local/bin:$PATH"   # KHÔNG phải $HOME/.compact/bin như docs ghi — docs sai

npm install
npm run build:contract        # compile + sinh proving key (~15s)
npm run build:contract:fast   # --skip-zk, đủ để chạy test, nhanh hơn nhiều
npm test                      # 54 test (~41s; test capacity đổ đầy 1024 leaf mất 35s trong đó)
npm run build:web
npm run dev:chain             # contract host :4000, phục vụ luôn web/dist
npm run dev                   # chain :4000 + Vite :5173 (hot reload)
```

**Chạy thật trên chain** — package riêng, `node_modules` riêng, vì `compact-runtime` 0.16.0 và 0.19.0 không sống chung một cây phụ thuộc được:

```bash
docker run -d -p 6300:6300 midnightntwrk/proof-server:8.1.0   # đúng cmd mặc định, không thêm cờ
cd onchain && npm install && npm run build   # build full ZK, có proving key
npm run address   -- preview   # in địa chỉ + URL faucet (bước duy nhất cần tay người)
npm run provision -- preview   # sync một lần → đăng ký DUST → deploy
npm run lifecycle -- preview   # chín bước, in tx hash, exit != 0 nếu thiếu một lần từ chối
npm run service   -- preview   # HTTP :4100 cho web UI chuyển sang chế độ on-chain
npm test                       # 28 test của bản port
```

Lần sync đầu **mất khoảng một tiếng** trên preview và **không phải treo máy** — nó stream 176,000 dust event. Sau đó có cache `.wallet-cache.preview.json`, lần sau khởi động trong vài giây. Đừng xoá nó vì "dọn rác".

Chạy một file hoặc một test:

```bash
npx vitest run tests/invariants/I2-revoked-cannot-present.test.ts
npx vitest run -t "rejects a presentation made with a pre-revocation Merkle path"
npx vitest                                    # watch mode
```

`scripts/probe-*.sh` là các script dò bề mặt API Compact trong WSL. Chúng **không phải test** — chúng là cách mọi tuyên bố trong RESEARCH.md được kiểm chứng. Khi cần biết Compact có hỗ trợ thứ gì không: **viết một probe và chạy, đừng đoán từ trí nhớ.**

---

## 7. Trạng thái hiện tại — có hai contract, đừng nhầm

| | `contracts/src/credential.compact` | `onchain/contract/credential.compact` |
|---|---|---|
| Vai trò | **Bản tham chiếu** | **Bản đang chạy trên preview** |
| Compiler / language | 0.34.0 / 0.26 | 0.31.1 / **0.23** |
| Runtime | compact-runtime 0.19.0 → onchain-runtime **v4 (RC)** | compact-runtime 0.16.0 → onchain-runtime **v3** |
| Deploy được? | **Không** — mọi mạng live chạy v3 | Đó là toàn bộ lý do nó tồn tại |
| Xác thực issuer | Chữ ký Schnorr Jubjub, verify trong circuit | **Chứng minh biết secret** khớp digest trong ledger |
| TS engine + test | đầy đủ, 54 test | đầy đủ, 28 test |
| Trạng thái | không deploy được, mãi mãi ở version set này | deployed `c301baf5…3193`, block 647,605 |
| Build | `npm run build:contract` | `onchain/build.sh` — gọi thẳng binary 0.31.1, không đụng default global |

**Vì sao phải port:** compiler 0.31.1 chỉ nhận language 0.23, và language 0.23 **không có bất kỳ primitive verify chữ ký nào** — chín cái tên ứng viên đã được thử, tất cả đều unbound (RESEARCH.md §G.3). Nên bản port thay chữ ký công khai bằng capability secret. **Cái giá đã ghi thẳng trong header của file đó**: không còn attestation chuyển nhượng được, không verify offline được, ai biết secret thì issue và revoke được. Giữ nguyên phần ghi chú trung thực này nếu sửa file.

Bản port đã build full ZK, đã deploy lên **preview**, và cả chín bước lifecycle đã chạy thật ở đó — kể cả ba lần từ chối. `npm run lifecycle -- preview` in ra tx hash cho từng bước; transcript nằm trong mục "On chain" của README.

**Chỉ preview.** Preprod bị loại có lý do đo được: 1,466,572 dust event so với 176,094 của preview, và faucet của nó nằm sau Cloudflare Turnstile nên không script được (RESEARCH.md §H.12). Code không có gì riêng cho preview — `onchain/src/network.ts` có sẵn endpoint preprod — nhưng **chưa chạy thì đừng nói là chạy được**.

Việc còn lại: ví trình duyệt ký trực tiếp lời gọi contract. Đường đó **đã chạy với extension thật** (1AM) và qua được bốn trên năm bước — kết nối, đọc số dư, nhận transaction đã prove, balance xong. **Bước submit bị node từ chối `Custom error: 182`** (mã replay protection).

Lỗi không nằm ở repo, và điều đó đã được chứng minh chứ không phải suy đoán: đúng transaction đó, cho ví của service balance rồi submit thì chain **nhận** (tx `00107806…`), và indexer cho thấy không có gì từ ví trình duyệt chạm tới contract. Nghi ngờ chính là đường **sponsored DUST** của ví đó.

Cách nói đúng: "đường trình duyệt chạy tới bước submit, và một ví từ chối ở đó" — **không** phải "wallet integration đã xong", cũng **không** phải "chưa từng thử".

**Bí mật ví là tiền thật trên testnet.** `onchain/.seed.*`, `.wallet-cache.*`, `.holders.*` đều đã trong `.gitignore` — kiểm tra lại bằng `git check-ignore` trước khi commit, đừng tin bằng mắt.

---

## 8. Quy ước khi sửa code

- **Mọi `disclose()` phải có comment biện minh cho đúng chỗ đó.** Hiện có 18 chỗ, tất cả đều có. Đây không phải trang trí — nó là cách duy nhất để review được ranh giới riêng tư.
- **Test âm phải assert đúng thông điệp từ chối**, không chỉ "có ném lỗi": `rejects.toThrow(/asOf is stale/)`. Nhiều đòn tấn công sẽ bị một check *phía sau* bắt được một cách tình cờ, và điều đó che mất regression ở check *phía trước*.
- **Mọi lời gọi `jubjubSchnorrVerify` phải bọc trong `assert(...)`.** Hàm này quá tải: một dạng tự assert, một dạng trả `Boolean`. Với cùng kiểu tham số, compiler chọn dạng `Boolean` và **kết quả bị vứt đi im lặng** — chữ ký giả mạo được chấp nhận. Lỗi này từng tồn tại thật: compile sạch, qua review, chỉ có test I6/I7 bắt được.
- **Thêm predicate** vào `contracts/src/Predicates.compact`. Bản port phải inline vì language 0.23 không cho tham chiếu kiểu có tiền tố module (`M.S` là lỗi parse).
- **Thời gian tính bằng SECONDS.** Đây không còn là giả định: `BlockContext.secondsSinceEpoch`, và chain đã từ chối một `present()` tính bằng ms rồi chấp nhận đúng lời gọi đó tính bằng giây (RESEARCH.md §H.11). `FRESHNESS_WINDOW_SEC = 300` trong `core/engine.ts` **phải khớp** với `freshnessWindow()` trong contract.
  Cái bẫy: sai đơn vị ở đây **không làm test đỏ**, vì simulator tự cấp block time cho chính nó — đưa vào ms, so với ms, mọi thứ khớp. Bản deploy đầu tiên mang `300000`, tức cửa sổ tươi **3,5 ngày** thay vì 5 phút, và chỉ chain thật mới phát hiện được. Bản đó nằm ở `onchain/deployments/superseded/`.
- Tree depth 10 ⇒ **tối đa 1024 credential**. Đã có test cho leaf thứ 1025 bị từ chối.
- Trước khi tuyên bố một API Compact tồn tại: kiểm chứng bằng probe, hoặc trích RESEARCH.md. Repo này được xây trên đúng nguyên tắc đó.
