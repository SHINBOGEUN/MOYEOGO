import { StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

export const styles = StyleSheet.create({
  container: { marginTop: 22, marginBottom: 20 },
  heading: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 },
  title: { color: colors.ink, fontFamily: 'serif', fontSize: 19 },
  note: { color: colors.muted, fontSize: 10, marginTop: 3 },
  addButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 18, backgroundColor: colors.primaryPale },
  addButtonText: { color: colors.primaryDark, fontSize: 11, fontWeight: '700' },
  empty: { minHeight: 82, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 10, padding: 14 },
  emptyTitle: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  emptyText: { color: colors.muted, fontSize: 10, marginTop: 4, textAlign: 'center' },
  photoList: { gap: 9, paddingBottom: 4 },
  photoCard: { width: 112, position: 'relative' },
  photo: { width: 112, height: 112, borderRadius: 8, backgroundColor: colors.line },
  coverBadge: { position: 'absolute', left: 5, top: 6, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, backgroundColor: colors.primary },
  coverBadgeText: { color: '#FFFFFF', fontSize: 8, fontWeight: '700' },
  removeButton: { position: 'absolute', right: 6, top: 6, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(32,34,31,0.72)' },
  removeButtonText: { color: '#FFFFFF', fontSize: 19, lineHeight: 22, marginTop: -2 },
  photoLocation: { color: colors.primaryDark, fontSize: 9, fontWeight: '600', marginTop: 5 },
  photoDate: { color: colors.muted, fontSize: 9, marginTop: 2 },
  coverSelected: { color: colors.primaryDark, fontSize: 9, fontWeight: '700', marginTop: 7 },
  setCoverButton: { minHeight: 26, marginTop: 5, justifyContent: 'center', alignItems: 'center', borderRadius: 13, backgroundColor: colors.primaryPale },
  setCoverButtonText: { color: colors.primaryDark, fontSize: 9, fontWeight: '700' },
});
