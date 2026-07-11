export interface EndingPolicy {
  mode: "bounded_longevity";
  softEndingAge: number;
  hardMaximumAge: number;
  criticalHealthThreshold: number;
  maximumAnnualProbability: number;
  annualBaseProbabilityByAge: Array<{ minAge: number; maxAge: number; probability: number }>;
}

export const DEFAULT_ENDING_POLICY: EndingPolicy = {
  mode: "bounded_longevity",
  softEndingAge: 73,
  hardMaximumAge: 110,
  criticalHealthThreshold: 15,
  maximumAnnualProbability: 0.85,
  annualBaseProbabilityByAge: [
    { minAge: 0, maxAge: 72, probability: 0 },
    { minAge: 73, maxAge: 79, probability: 0.02 },
    { minAge: 80, maxAge: 89, probability: 0.05 },
    { minAge: 90, maxAge: 99, probability: 0.12 },
    { minAge: 100, maxAge: 109, probability: 0.25 },
    { minAge: 110, maxAge: Number.POSITIVE_INFINITY, probability: 1 }
  ]
};
