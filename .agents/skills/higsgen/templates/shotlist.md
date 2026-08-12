# ショットリスト — {{title}}

シングルジェネレーション用。**このマスタープロンプト 1 本で完成尺の動画を 1 回生成する。**

## params

| 項目 | 値 |
|------|-----|
| model | seedance_2_0（15秒） / seedance_2_5（30秒） / minimax_h3（15秒・2K） ← brief.md のエンジン |
| duration | 15 / 30 / 15 |
| aspect_ratio | {{ar}} |
| resolution | 2.0: 720p〜4k / 2.5: 480p・720p / H3: "2K" 固定 |
| generate_audio | true / false（brief.md の音声方針）。**minimax_h3 は非対応（無音）→ 別撮り** |
| mode（2.5 のみ） | omni_reference（参照画像あり時）/ t2v |
| genre（2.0 のみ） | auto / action / comedy / drama / ... |

## refs（medias に渡す参照。role: image_references）

| キャラ | job_id / media_id |
|--------|-------------------|
| {{name}} | {{job_id}} |

## master_prompt

```
{{全体方針: スタイル・トーン・カメラの基本方針を 1〜2 文}}

Shot 1 ({{X}}s): {{カメラサイズ・アングル・ムーブ}}. {{キャラ識別子（一貫させる）}} {{芝居・アクション}}. {{背景・照明}}. dialogue: "{{セリフ}}" sfx: {{効果音}}
Shot 2 ({{X}}s): ...
Shot 3 ({{X}}s): ...

{{スタイルキーワード（brief.md）}}
```

<!-- 記入ルール:
  - Shot の秒数合計 = duration に厳密一致
  - キャラの外見長文は書かない（image_references が担保）。識別子は毎ショット同一表記
  - 1 ショット 1 アクション。「開始 → 終了」がひとつの動きでつながること
  - セリフ/SE はネイティブ音声が拾えるよう dialogue: / sfx: で明記 -->

## 生成記録（Phase 5 で記入）

- **video_job_id**:
- **結果 URL**:
- **保存先**: assets/clips/main.mp4

## 音声原稿まとめ（別撮り VO/BGM がある場合）

### ナレーション（確定稿）

```
{{narration_final}}
```

### BGM 指示

```
{{雰囲気・テンポ・楽器・尺}}
```
