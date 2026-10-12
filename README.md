# Alexa+ × ChipLoop: local synthetic demonstration

This package is a browser-only, deterministic demonstration of a text request routed to a ChipLoop-inspired experiment-design scorer. It does not connect to Alexa+, an LLM, a network service, an experiment, or a clinical system. All values are synthetic. Physical and clinical validation are `NOT_RUN`; external submission was `NOT_SUBMITTED` at preparation time. See the hosting platform for current publication and submission status.

## Run locally

Serve this folder with a static server, for example:

```text
python -m http.server 8000
```

Open `http://127.0.0.1:8000/index.html`. The app requires no server API or external account.

## Reproducible example and risk interpretation

With the included initial synthetic observations and the default toxicity reference cap of 0.35, the local scorer ranks C104 first. Its parameters are dose **8.111308 µM**, time **36 h**, and flow **4 µL/min**. The model toxicity upper estimate is **0.351170635** (displayed as 0.351), which is **above** the 0.35 cap; its `risk_flag` is true and human review is required. A recommendation is only a synthetic review prompt. The interval is not calibrated as a safety guarantee, and no physical or clinical conclusion follows from it.

The scorer forms the upper estimate from the synthetic toxicity mean plus 1.645 times its nominal predictive standard deviation, clipped to [0,1]. Its acquisition score includes a penalty of 2 times any exceedance above the cap. Thus the top-ranked C104 can still exceed the cap: the penalty reduces its ranking score; it does not enforce a hard safety constraint.

## Provenance, sources, and licenses

This is the author's Alexa+ adaptation of the earlier **BM02 ChipLoop** project. The retained source project's `README.md` and `THIRD_PARTY_NOTICES.md` are in `outputs/submission_stageB_20261008/BM02_ChipLoop_candidate/`; that project declares its original code under MIT and documents NumPy (BSD) and Python (PSF) dependencies. This small package includes no copied dependency, data file, model weight, font, or media asset from those dependencies. Its browser scorer is a deterministic synthetic adaptation; it is not the original Python application.

The earlier project's technical report cites the public [AI4S Open Innovation competition overview on Kaggle](https://www.kaggle.com/competitions/ai-4-s-open-innovation-artificial-intelligence-for-life-scien/overview). The retained 2026-10-08 platform receipt records the prior ChipLoop [Kaggle write-up](https://www.kaggle.com/competitions/ai-4-s-open-innovation-artificial-intelligence-for-life-scien/writeups/new-writeup-1791399345451) as submitted and identifies that write-up license as CC BY 4.0; it separately records the prior project's source code as MIT and its Kaggle notebook as Apache 2.0. These are project provenance references; the write-up and notebook are not redistributed here. No public URL for the earlier source repository or notebook was present in the retained receipt, so none is asserted here.

The included `LICENSE` applies to this package's author-owned code and documentation. It does not relicense third-party software. No third-party package is required at runtime.

## AI assistance and evidence limits

OpenAI Codex assisted with code structure, wording, and the deterministic JavaScript adaptation. The author remains responsible for review. The included self-test is a local software check, not scientific validation or a platform receipt. No real experiment, patient data, clinical validation, or external acceptance is claimed.

## Files

- `index.html` — local user interface.
- `app.js` — bounded intent router, synthetic scorer, browser behavior, and self-test.
- `LICENSE` — MIT license for this package.
- `manifest.json` — file sizes and SHA-256 checksums.
- `media/alexa_chiploop_demo.mp4` — silent 72-second walkthrough assembled from six actual browser screenshots, in their recorded order. Each screenshot shows a real local app interaction state; the file is a still-frame walkthrough, not a continuous screen recording and not a live Alexa integration.

Preparation snapshot: 2026-10-12. Hosting and submission status must be verified on GitHub, YouTube and Devpost; this local package and its self-test do not establish external acceptance.


