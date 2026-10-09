export function scoreLead(input: {
  email: string | null;
  phone: string | null;
  city?: string | null;
  answers: number;
}): number {
  let score = 0;
  if (input.phone) score += 30;
  if (input.email) score += 20;
  if (input.city) score += 10;
  score += Math.min(input.answers * 10, 40);
  return Math.min(score, 100);
}
