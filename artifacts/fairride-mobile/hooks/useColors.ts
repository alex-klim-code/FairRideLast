import colors from '@/constants/colors';

/** Single palette: native passenger UI mirrors the Chrome passenger UI exactly. */
export function useColors() {
  return { ...colors.light, radius: colors.radius };
}
