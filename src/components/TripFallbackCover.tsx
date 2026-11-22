import { Image, type ImageStyle, type StyleProp } from 'react-native';

const covers = {
  1: require('../../assets/trip-cover-1-topographic.jpg'),
  2: require('../../assets/trip-cover-2-coast.jpg'),
  3: require('../../assets/trip-cover-3-scrapbook.jpg'),
  4: require('../../assets/trip-cover-4-paper-landscape.jpg'),
  5: require('../../assets/trip-cover-5-forest.jpg'),
} as const;

export function TripFallbackCover({ option, style }: { option: number; style: StyleProp<ImageStyle> }) {
  const source = covers[option as keyof typeof covers] ?? covers[2];
  return <Image source={source} style={style} resizeMode="cover" accessible={false} />;
}
