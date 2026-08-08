# VoicePaste GitHub Actions 缓存策略

## 决策

| 项目                   | 结论                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 是否换 `actions/cache` | **换。** CI/Release 用显式 `actions/cache@v6` 取代 `Swatinem/rust-cache@v2`；收益来自删掉 rust-cache wrapper 的前置探测与清理，不是换缓存后端。若路径完全不变，仅改 action 名称，不会本质改善 tar/zstd 与上传下载成本。 |
| Cargo registry/git     | **缓存 registry，不缓存 git。** 三平台缓存 `registry/index`、`registry/cache`；当前无 git dependency，暂不缓存 `git/db`。                                                                                               |
| `src-tauri/target`     | **CI 三平台缓存；Release 不缓存。** Windows 当前 target 暖缓存仍有净收益；Release tag 通常一次性、ref 隔离且 target 很大，不值得每个 tag 保存一份。                                                                     |
| mise                   | **保留 action 自带 cache。** 它缓存 mise data dir，不等于 Cargo/pnpm 项目缓存。                                                                                                                                         |
| pnpm store             | **不缓存。** 当前 `pnpm install` 仅 1–5 秒，pnpm 官方也不保证 store cache 更快。                                                                                                                                        |
| `node_modules`         | **不缓存。** 它是由 pnpm store + lockfile 重建的 hard-link/symlink 工作树。                                                                                                                                             |
| APT                    | **不缓存。** 新 VM 仍须安装并执行 dpkg scripts；当前仅 25–42 秒。                                                                                                                                                       |

当前 workflow：[`ci.yml`](https://github.com/imbytecat/voicepaste/blob/main/.github/workflows/ci.yml)、[`release.yml`](https://github.com/imbytecat/voicepaste/blob/main/.github/workflows/release.yml)。

## 根因

### issue #169：Windows 大归档成本，不是 rust-cache 专属后端

[`Swatinem/rust-cache#169`](https://github.com/Swatinem/rust-cache/issues/169) 报告 Windows post-run 保存超过 5 分钟，而 macOS 约 38 秒。issue 没有 maintainer 给出的单一底层结论；讨论分别指向网络、zstd、Git for Windows GNU tar。能确认的架构根因是：大而且文件多的 Cargo `target` 在 Windows 上需要 tar 遍历、zstd 压缩/解压及传输，这些归档成本可能很高。

rust-cache 当前直接依赖 `@actions/cache ^6.2.0`（[`package.json`](https://github.com/Swatinem/rust-cache/blob/master/package.json)），README 也明确说明它建立在 GitHub upstream cache action 之上（[Cache Limits and Control](https://github.com/Swatinem/rust-cache#cache-limits-and-control)）；其 [`restore.ts`](https://github.com/Swatinem/rust-cache/blob/master/src/restore.ts) / [`save.ts`](https://github.com/Swatinem/rust-cache/blob/master/src/save.ts) 最终调用 `restoreCache` / `saveCache`。`actions/cache` 当前自身同样依赖 `@actions/cache ^6.2.0`（[`actions/cache/package.json`](https://github.com/actions/cache/blob/main/package.json)），toolkit 在 Windows 优先使用 GNU tar 并配合 zstd（[`tar.ts`](https://github.com/actions/toolkit/blob/main/packages/cache/src/internal/tar.ts)）。因此两者使用同一 GitHub cache service 与同类归档路径。

结论：**仅把同一批路径从 rust-cache 搬到 actions/cache，不能消除 #169；必须同时控制路径、cache 大小与 key。**

### VoicePaste 当前 6–7 分钟 Windows 慢点：rust-cache 前置 wrapper

本仓库的主要问题并非 cache 网络：

- [CI #17 Windows](https://github.com/imbytecat/voicepaste/actions/runs/31262666038/job/93115784222) 中 rust-cache step 共 360 秒；带时间戳日志显示约 359.8 秒花在打印 `Cache Configuration` 之前，真正 `... Restoring cache ...` 到 `No cache found` 仅约 0.18 秒。
- [CI #16 Windows](https://github.com/imbytecat/voicepaste/actions/runs/31261155866/job/93112043963) exact hit 共 391 秒；前置阶段约 371.6 秒，760 MB 下载按日志速率约 4.5 秒，Git tar/zstd 解压约 15.6 秒。
- [CI #18 Windows](https://github.com/imbytecat/voicepaste/actions/runs/31264357369/job/93119989944) exact hit 同样为 422 秒。

源码对应关系清楚：rust-cache 在真正查询 cache 前，`CacheConfig.new()` 会探测 rustc/rustup、解析 manifest/lock、生成 key；[`workspace.ts`](https://github.com/Swatinem/rust-cache/blob/master/src/workspace.ts) 还执行 `cargo metadata`。日志没有再细分这些 wrapper 子步骤，不能断言其中某一个命令独占全部时间；但可确定约 6 分钟发生在 cache API 之前。

所以，VoicePaste 改用直接 `actions/cache` **会实质改善**：它删除约 6–7 分钟 rust-cache wrapper 开销。缓存后端、tar/zstd 和传输仍相同，约 20–60 秒的大 archive 成本仍在。

### 为什么不推荐 `cache-targets: ${{ runner.os != 'Windows' }}`

若继续使用 rust-cache，把 `cache-targets` 设为 `${{ runner.os != 'Windows' }}`，Windows 只会从 `cachePaths` 删除 `src-tauri/target`；`CacheConfig.new()` 的 rustc/rustup 探测、`cargo metadata`、manifest/lock 解析与 key 生成仍在真正 restore 前执行。因此它只能减少 Windows archive 大小和保存/解压成本，**不能消除当前约 6–7 分钟根因**。

直接使用 actions/cache 后则不同：wrapper 前置阶段被完全删除。Windows #16 的 760 MB target 实际下载约 4.5 秒、解压约 15.6 秒，而 target hit 后 `test + clippy` 为 67 秒，miss 为 360 秒；约 20 秒 restore 换取约 293 秒编译节省。故当前推荐不是“继续 rust-cache、Windows `cache-targets=false`”，而是“CI 三平台直接 actions/cache 并缓存 target；Release 不缓存 target”。

## 缓存什么

### Cargo registry/git：下载缓存

Cargo 官方说明 `$CARGO_HOME` 是下载和源码缓存：

- `registry/index`：registry 元数据；
- `registry/cache`：下载后的压缩 `.crate`；
- `git/db`：git dependency 的 bare repo；
- `registry/src`、`git/checkouts` 可由上述内容重建。

Cargo 官方 CI 建议仅缓存 `registry/index`、`registry/cache`、`git/db` 等；缓存整个 Cargo home 会同时保存压缩包与解压源码，增加下载、解压、重压缩和上传时间（[Cargo Home: Caching in CI](https://doc.rust-lang.org/cargo/guide/cargo-home.html#caching-the-cargo-home-in-ci)）。

VoicePaste 没有 `cargo install`，也没有 `git+` dependency，故不缓存 `.cargo/bin`、`.crates.toml`、`.crates2.json`、`git/db`；也不缓存 `registry/src`、`git/checkouts`。若以后 `Cargo.lock` 出现 git source，再加入 `~/.cargo/git/db/`。

推荐：

```yaml
path: |
  ~/.cargo/registry/index/
  ~/.cargo/registry/cache/
key: cargo-src-v1-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('src-tauri/Cargo.lock') }}
restore-keys: |
  cargo-src-v1-${{ runner.os }}-${{ runner.arch }}-
```

lock 变化时，prefix restore 复用已有下载，Cargo 只补齐差异。GitHub 官方的匹配顺序与 prefix 行为见 [Dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#cache-key-matching) 与 [`actions/cache` strategies](https://github.com/actions/cache/blob/main/caching-strategies.md)。

### `src-tauri/target`：编译缓存

Cargo 将最终产物与 `deps`、`.fingerprint`、build-script、incremental 等中间产物写入 target/build dir（[Cargo build cache](https://doc.rust-lang.org/cargo/reference/build-cache.html)）。它与 registry/git 的语义、体积、失效条件不同，必须单独 cache。

**CI：三平台缓存 target。** 当前证据：

- CI #17 cold `cargo test + clippy`：Linux 187 秒、macOS 173 秒、Windows 360 秒。
- CI #18 warm：Linux 21 秒、macOS 24 秒。
- Windows #16 warm：67 秒；虽然是旧 Rust/toolchain，只能作方向性样本，但相比 Windows cold 360 秒差距很大。
- 同 toolchain 的 #17 miss 与 #18 hit 表明 Windows 777 MB archive 的额外 restore 约 62 秒；仍远小于约 4–5 分钟编译差额。

**Release：不缓存 target。** GitHub cache 按 key/version/ref 隔离，不同 tag 不能互相恢复 cache（[Restrictions for accessing a cache](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache)）。每个 release tag 通常只构建一次，保存数百 MB target 只利于同 tag rerun；当前唯一 Release 样本三平台 target cache 合计约 1.61 GB。Release 保留 Cargo source cache即可。

CI target key 必须隔离 OS、arch 与 Rust toolchain；同 toolchain 下可恢复旧 lock/manifest target：

```yaml
path: src-tauri/target/
key: cargo-target-ci-v1-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('mise.toml') }}-${{ hashFiles('src-tauri/Cargo.lock', 'src-tauri/Cargo.toml') }}
restore-keys: |
  cargo-target-ci-v1-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('mise.toml') }}-
```

不把 commit SHA 放入 key，否则每次提交都会创建新 cache；Cargo fingerprints 会判断项目代码是否需重编译。保留 `CARGO_INCREMENTAL=0`，与 rust-cache 当前行为一致，并避免把大量跨 ephemeral runner 价值有限的 incremental 碎片存入 archive（[rust-cache Cache Details](https://github.com/Swatinem/rust-cache#cache-details)）。

## 实际 restore/save 成本与容量

样本均来自公开 Actions 日志；GitHub step 时长按秒显示。CI #17 是当前 toolchain 的 miss/save，CI #18 命中 #17 cache；#18 Windows 在 restore 后因 concurrency 被后续 push 取消。

| 平台             | #17 miss rust-cache step | #18 hit rust-cache step |        实际 archive restore 增量估算 |                    archive 大小 | #17 save/post |
| ---------------- | -----------------------: | ----------------------: | -----------------------------------: | ------------------------------: | ------------: |
| Ubuntu 24.04 x64 |                       1s |                     17s |                               约 16s | 1,173,282,398 B（约 1,119 MiB） |           17s |
| macOS 26 arm64   |                       1s |                     10s |                                约 9s |     683,728,964 B（约 652 MiB） |           43s |
| Windows 2025 x64 |                     360s |                    422s | 约 62s；#16 精细日志约 20s 下载+解压 |     814,578,456 B（约 777 MiB） |           46s |

“restore 增量”是相邻、同 toolchain 运行的 `hit step - miss step`，仍受 runner region/image 抖动影响；Windows #16 的带时间戳日志更能说明 cache 本身约 20 秒，而 6 分钟主要是 wrapper。

[Release #1](https://github.com/imbytecat/voicepaste/actions/runs/31260078089) 为 workflow_dispatch、旧 toolchain：save/post 为 Linux 13 秒、macOS 37 秒、Windows 50 秒；它当时使用 macOS 15，当前 YAML 已是 macOS 26，不能当作当前 release 暖缓存基准。

抓取 [Actions cache inventory API](https://api.github.com/repos/imbytecat/voicepaste/actions/caches?per_page=100) 时共有 29 项、10,720,797,067 B（约 9.99 GiB，几乎触及 GitHub 文档所述默认 10 GB 容量）：

- rust caches：9,555,487,027 B；
- mise caches：1,165,310,040 B。

旧 Rust/toolchain、CI/Release、三个 OS 各自生成大 cache，已形成容量压力。GitHub 会按访问时间淘汰旧项，未访问超过 7 天也会删除；频繁超过容量会 cache thrashing（[Usage limits and eviction policy](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#usage-limits-and-eviction-policy)）。移除 Release target、拆分 Cargo source/target，能减少无复用的大 archive，并让 target 可独立监控或关闭。

局限：公开样本少；runner region/image、网络、依赖与 archive 内容会变化；尚无新 YAML 的真实 A/B。上线后应比较至少 5 次同 lockfile 暖 CI；若 Windows 直接 actions/cache 的 `restore + warm compile` 稳定大于 source-only cold compile，再只关闭 Windows target。

## mise-action 缓存什么

`jdx/mise-action@v4` 默认 `cache: true`。当前源码的 [`restoreMiseCache`](https://github.com/jdx/mise-action/blob/main/src/index.ts) 只把 `miseDir()` 作为 path：Unix 默认 `~/.local/share/mise`，Windows 默认 `%LOCALAPPDATA%\mise`；[`saveCache`](https://github.com/jdx/mise-action/blob/main/src/index.ts) 保存同一目录。默认 key 含 runner platform/image、mise version input、`install_args` hash、bootstrap 参数和 mise config hash（[mise-action Cache Configuration](https://github.com/jdx/mise-action#cache-configuration)）。

因此它缓存 mise 自身及 data dir 内安装的工具；当前 frontend/release 的 Node、pnpm 位于该目录并受益。Rust 由 rustup 安装，toolchain 在 `RUSTUP_HOME`，不在 mise data dir；mise-action README 也专门提示 rustup/cache 交互（[Rust Cache](https://github.com/jdx/mise-action#rust-cache)）。它**不缓存** Cargo registry/git/target、pnpm store、项目 `node_modules` 或 APT。

当前日志中 rust-only mise archive 约 24–40 MB；cache hit 后 rustup 仍可能同步/补组件。保留 mise-action 自带 cache，不再为 Node/pnpm/mise 另建重复 cache。

## pnpm、node_modules、APT

- **pnpm store：不缓存。** pnpm 官方 CI 文档明确说 store cache 不是必需，也不保证让安装更快（[pnpm CI](https://pnpm.io/continuous-integration)）。本仓库 CI frontend 的 `pnpm install` 为 2 秒；Release 三平台为 2、4、5 秒，新增 restore/save 很可能倒亏。若未来安装稳定显著变慢，只缓存 `pnpm store path` 返回的 store。
- **`node_modules`：不缓存。** pnpm 用 content-addressable store 文件的 hard link 与依赖图 symlink 生成 `node_modules`（[Symlinked node_modules structure](https://pnpm.io/symlinked-node-modules-structure)）；归档它会重复 store 内容，并带来跨平台链接和原生包风险。
- **APT：不缓存。** GitHub-hosted runner 每个 job 是新 VM（[GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners)）；缓存 `.deb` 不能恢复已安装的 dpkg/system state。本仓库 Linux APT 实测 25–42 秒，不足以支撑额外 cache 生命周期。

## 当前三平台最小 YAML

CI 用两份 cache：小而稳定的 Cargo sources，以及单独的 target。Release 复用 `Cache Cargo sources`，省略 `Cache Cargo target`。

```yaml
jobs:
  rust:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-24.04, macos-26, windows-2025]
    runs-on: ${{ matrix.os }}
    env:
      CARGO_INCREMENTAL: "0"
    steps:
      - uses: actions/checkout@v7

      - name: Install Linux system dependencies
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libasound2-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev libxkbcommon-dev

      - uses: jdx/mise-action@v4
        with:
          install_args: rust

      - name: Cache Cargo sources
        uses: actions/cache@v6
        with:
          path: |
            ~/.cargo/registry/index/
            ~/.cargo/registry/cache/
          key: cargo-src-v1-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('src-tauri/Cargo.lock') }}
          restore-keys: |
            cargo-src-v1-${{ runner.os }}-${{ runner.arch }}-

      - name: Cache Cargo target
        uses: actions/cache@v6
        with:
          path: src-tauri/target/
          key: cargo-target-ci-v1-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('mise.toml') }}-${{ hashFiles('src-tauri/Cargo.lock', 'src-tauri/Cargo.toml') }}
          restore-keys: |
            cargo-target-ci-v1-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('mise.toml') }}-

      - run: cargo test --locked --manifest-path src-tauri/Cargo.toml
      - run: cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

不启用 `enableCrossOsArchive`：target 不能跨 OS；Cargo sources 也没有必要为当前固定三平台引入跨 OS tar 兼容复杂度。`actions/cache@v6` 的 key、path、restore/save 与容量行为见其[当前 README](https://github.com/actions/cache)。
