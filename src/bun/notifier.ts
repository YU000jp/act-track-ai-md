import type { ActivityCategory } from "../shared/types";

type NotifySample = {
  category: ActivityCategory;
  processName: string;
  windowTitle: string;
};

type NotifierConfig = {
  notify: (title: string, body: string) => void;
  now: () => number;
  graceMs: number;
  cooldownMs: number;
};

export type NotifierPolicy = {
  onSample: (sample: NotifySample) => void;
};

export function createNotifierPolicy(config: NotifierConfig): NotifierPolicy {
  let distractionStartedAt: number | null = null;
  let lastNotifiedAt: number | null = null;

  return {
    onSample(sample) {
      const now = config.now();

      if (sample.category !== "distraction") {
        distractionStartedAt = null;
        return;
      }

      if (distractionStartedAt === null) {
        distractionStartedAt = now;
      }

      const elapsed = now - distractionStartedAt;
      if (elapsed < config.graceMs) return;

      if (lastNotifiedAt !== null && (now - lastNotifiedAt) < config.cooldownMs) return;

      config.notify(
        "\u{1F3AF} Kembali Fokus!",
        `Kamu sudah di ${sample.processName} terlalu lama. Waktunya balik kerja!`,
      );
      lastNotifiedAt = now;
    },
  };
}
