// Каталог локальных моделей (NFR-25, ADR-0011): что скачивает загрузчик. Адреса закреплены на коммит репозитория
// Hugging Face (`/resolve/<коммит>/…`), sha256 и размеры взяты из метаданных LFS (малые файлы NER — посчитаны по самим
// файлам на ту же дату, 2026-10-29): модель не «уплывёт» молча, а подмена файла не пройдёт проверку суммы. Минимальный
// набор ≈ 4,3 ГиБ (+ 0,18 ГиБ NER): чат Qwen3.5-4B Q4_K_M с mmproj, эмбеддинги bge-m3 Q8_0, речь whisper large-v3-turbo
// q5_0 и русская NER для маскирования (PRIV-03). Обновление модели — новая запись с новым коммитом и суммой.
export interface CatalogFile {
  /** Путь относительно `<DATA_DIR>/models`. */
  readonly path: string;
  readonly url: string;
  readonly sha256: string;
  readonly size: number;
}

export type ModelKind = "chat" | "embedding" | "speech" | "ner";

export interface CatalogModel {
  /** Идентификатор модели каталога (для llama-server — имя секции пресета). */
  readonly id: string;
  readonly kind: ModelKind;
  readonly files: readonly CatalogFile[];
}

const hf = (repo: string, commit: string, file: string) =>
  `https://huggingface.co/${repo}/resolve/${commit}/${file}`;

const QWEN = ["unsloth/Qwen3.5-4B-GGUF", "e87f176479d0855a907a41277aca2f8ee7a09523"] as const;
const BGE = ["ggml-org/bge-m3-Q8_0-GGUF", "9eba04c5d75ba5a1595e45de734d36bef4e5cb98"] as const;
const WHISPER = ["ggerganov/whisper.cpp", "5359861c739e955e79d9a303bcbc70fb988958b1"] as const;
const NER = [
  "onnx-community/bert-base-NER-Russian-ONNX",
  "2bd219a78a06657c59fa8c2540ccbad703972e7c",
] as const;

export const CATALOG: readonly CatalogModel[] = [
  {
    id: "qwen3.5-4b",
    kind: "chat",
    files: [
      {
        path: "llm/qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf",
        url: hf(...QWEN, "Qwen3.5-4B-Q4_K_M.gguf"),
        sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
        size: 2_740_937_888,
      },
      {
        path: "llm/qwen3.5-4b/mmproj-F16.gguf",
        url: hf(...QWEN, "mmproj-F16.gguf"),
        sha256: "cd88edcf8d031894960bb0c9c5b9b7e1fea6ebee02b9f7ce925a00d12891f864",
        size: 672_423_616,
      },
    ],
  },
  {
    id: "bge-m3",
    kind: "embedding",
    files: [
      {
        path: "embed/bge-m3-q8_0.gguf",
        url: hf(...BGE, "bge-m3-q8_0.gguf"),
        sha256: "aa473d51f451a22f0fcf39ba3330c14bed38a385712b1113440f69df4047a173",
        size: 634_553_760,
      },
    ],
  },
  {
    id: "whisper-large-v3-turbo",
    kind: "speech",
    files: [
      {
        path: "whisper/ggml-large-v3-turbo-q5_0.bin",
        url: hf(...WHISPER, "ggml-large-v3-turbo-q5_0.bin"),
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
        size: 574_041_195,
      },
    ],
  },
  {
    id: "ner-ru",
    kind: "ner",
    files: [
      {
        path: "ner/onnx/model_int8.onnx",
        url: hf(...NER, "onnx/model_int8.onnx"),
        sha256: "49f4f22a7d939d2f774e9eab326dff7b483ffecb37fd2d34f4026bac96b5efa1",
        size: 178_470_706,
      },
      {
        path: "ner/config.json",
        url: hf(...NER, "config.json"),
        sha256: "94db975aad4443077c7ca92cdbcb114397e96991066638988449c9df65a7e780",
        size: 2392,
      },
      {
        path: "ner/tokenizer.json",
        url: hf(...NER, "tokenizer.json"),
        sha256: "7d76a4d25ebe8f217654f1039bd991bfc96e7c2cd36e6d28aff941783ed1e9c8",
        size: 2_919_460,
      },
      {
        path: "ner/tokenizer_config.json",
        url: hf(...NER, "tokenizer_config.json"),
        sha256: "4a9ec4b35fb1660a015c856e7aafc1da91db380f662cdabf8fcee726975b55f3",
        size: 1329,
      },
      {
        path: "ner/special_tokens_map.json",
        url: hf(...NER, "special_tokens_map.json"),
        sha256: "5d5b662e421ea9fac075174bb0688ee0d9431699900b90662acd44b2a350503a",
        size: 695,
      },
      {
        path: "ner/vocab.txt",
        url: hf(...NER, "vocab.txt"),
        sha256: "fe0fda7c425b48c516fc8f160d594c8022a0808447475c1a7c6d6479763f310c",
        size: 995_526,
      },
    ],
  },
];

export const totalBytes = (models: readonly CatalogModel[] = CATALOG): number =>
  models.reduce((sum, model) => sum + model.files.reduce((s, file) => s + file.size, 0), 0);
