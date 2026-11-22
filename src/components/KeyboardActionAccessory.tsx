import { InputAccessoryView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export function KeyboardActionAccessory({
  nativeID,
  label = '완료',
  onPress,
}: {
  nativeID: string;
  label?: string;
  onPress: () => void;
}) {
  if (Platform.OS !== 'ios') return null;

  return (
    <InputAccessoryView nativeID={nativeID}>
      <View style={styles.toolbar}>
        <Pressable onPress={onPress} style={styles.actionButton} accessibilityRole="button">
          <Text style={styles.actionText}>{label}</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  toolbar: { minHeight: 44, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 14, backgroundColor: colors.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  actionButton: { minWidth: 56, minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  actionText: { color: colors.primaryDark, fontSize: 15, fontWeight: '700' },
});
