import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardActionAccessory } from './KeyboardActionAccessory';
import { KOREAN_REGIONS, type RegionNode } from '../data/koreanRegions';
import { colors } from '../theme/colors';

function childrenAt(path: string[]): RegionNode[] {
  let current = KOREAN_REGIONS;
  for (const name of path) {
    const node = current.find((item) => item.name === name);
    if (!node?.children) return [];
    current = node.children;
  }
  return current;
}

export function RegionPicker({
  value,
  onChange,
  detailAddress,
  onDetailAddressChange,
  onInputFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  detailAddress: string;
  onDetailAddressChange: (value: string) => void;
  onInputFocus?: (input: TextInput | null) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [path, setPath] = useState<string[]>([]);
  const [mode, setMode] = useState<'select' | 'manual'>('select');
  const [focusDetailAfterSelection, setFocusDetailAfterSelection] = useState(false);
  const destinationInput = useRef<TextInput>(null);
  const detailAddressInput = useRef<TextInput>(null);
  const options = useMemo(() => childrenAt(path), [path]);

  useEffect(() => {
    if (!focusDetailAfterSelection || visible || !value.trim()) return;

    const focusTimer = setTimeout(() => {
      detailAddressInput.current?.focus();
      setFocusDetailAfterSelection(false);
    }, 300);

    return () => clearTimeout(focusTimer);
  }, [focusDetailAfterSelection, value, visible]);

  const close = () => setVisible(false);
  const chooseCurrent = () => {
    if (path.length === 0) return;
    onChange(path.join(' '));
    setFocusDetailAfterSelection(true);
    close();
  };

  const choose = (node: RegionNode) => {
    const nextPath = [...path, node.name];
    if (node.children?.length) {
      setPath(nextPath);
      return;
    }
    onChange(nextPath.join(' '));
    setFocusDetailAfterSelection(true);
    close();
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>여행 지역</Text>
      <View style={styles.modeSwitch}>
        <Pressable onPress={() => { Keyboard.dismiss(); setMode('select'); }} style={[styles.modeButton, mode === 'select' && styles.selectedModeButton]} accessibilityRole="button">
          <Text style={[styles.modeText, mode === 'select' && styles.selectedModeText]}>지역 선택</Text>
        </Pressable>
        <Pressable onPress={() => setMode('manual')} style={[styles.modeButton, mode === 'manual' && styles.selectedModeButton]} accessibilityRole="button">
          <Text style={[styles.modeText, mode === 'manual' && styles.selectedModeText]}>직접 입력</Text>
        </Pressable>
      </View>
      {mode === 'select' ? (
        <Pressable
          onPress={() => { Keyboard.dismiss(); setPath([]); setVisible(true); }}
          style={styles.valueButton}
          accessibilityRole="button"
          accessibilityLabel="여행 지역 선택"
        >
          <Text style={[styles.valueText, !value && styles.placeholder]} numberOfLines={2}>
            {value || '지역을 선택해 주세요'}
          </Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ) : (
        <TextInput
          ref={destinationInput}
          value={value}
          onChangeText={onChange}
          onFocus={() => onInputFocus?.(destinationInput.current)}
          onSubmitEditing={() => {
            if (value.trim()) detailAddressInput.current?.focus();
            else Keyboard.dismiss();
          }}
          inputAccessoryViewID="trip-destination-keyboard-action"
          placeholder="예: 강원도 강릉시 경포대"
          placeholderTextColor={colors.muted}
          style={styles.textInput}
          returnKeyType={value.trim() ? 'next' : 'done'}
        />
      )}
      {mode === 'manual' ? (
        <KeyboardActionAccessory
          nativeID="trip-destination-keyboard-action"
          label={value.trim() ? '다음' : '완료'}
          onPress={() => {
            if (value.trim()) detailAddressInput.current?.focus();
            else Keyboard.dismiss();
          }}
        />
      ) : null}
      {value.trim().length > 0 ? (
        <View style={styles.detailField}>
          <Text style={styles.label}>상세 주소 (선택)</Text>
          <TextInput
            ref={detailAddressInput}
            value={detailAddress}
            onChangeText={onDetailAddressChange}
            onFocus={() => onInputFocus?.(detailAddressInput.current)}
            onSubmitEditing={Keyboard.dismiss}
            inputAccessoryViewID="trip-detail-address-keyboard-action"
            placeholder="예: 경포로 365 또는 숙소·장소 이름"
            placeholderTextColor={colors.muted}
            style={styles.textInput}
            returnKeyType="done"
          />
          <KeyboardActionAccessory
            nativeID="trip-detail-address-keyboard-action"
            onPress={Keyboard.dismiss}
          />
        </View>
      ) : null}

      <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="닫기" />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>여행 지역 선택</Text>
                <Text style={styles.sheetHint}>더 상세한 지역으로 들어가거나 현재 지역을 선택하세요.</Text>
              </View>
              <Pressable onPress={close} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="닫기">
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.breadcrumbScroll}>
              <View style={styles.breadcrumbRow}>
                <Pressable onPress={() => setPath([])} style={styles.crumbButton}>
                  <Text style={[styles.crumbText, path.length === 0 && styles.activeCrumb]}>전국</Text>
                </Pressable>
                {path.map((part, index) => (
                  <View key={`${part}-${index}`} style={styles.crumbPart}>
                    <Text style={styles.crumbDivider}>›</Text>
                    <Pressable onPress={() => setPath((current) => current.slice(0, index + 1))} style={styles.crumbButton}>
                      <Text style={[styles.crumbText, index === path.length - 1 && styles.activeCrumb]}>{part}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </ScrollView>

            {path.length > 0 ? (
              <Pressable onPress={chooseCurrent} style={styles.chooseCurrentButton} accessibilityRole="button">
                <Text style={styles.chooseCurrentText}>‘{path[path.length - 1]}’ 여기로 선택</Text>
              </Pressable>
            ) : null}

            <Text style={styles.listHeading}>{path.length === 0 ? '시·도' : `${path[path.length - 1]} 아래 지역`}</Text>
            <ScrollView style={styles.optionsList}>
              {options.map((node) => (
                <Pressable key={node.name} onPress={() => choose(node)} style={styles.optionRow}>
                  <Text style={styles.optionName}>{node.name}</Text>
                  <Text style={styles.optionAction}>{node.children?.length ? '›' : '선택'}</Text>
                </Pressable>
              ))}
              {options.length === 0 ? <Text style={styles.emptyText}>더 상세한 행정구역이 없습니다.</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 17 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700', marginBottom: 8, marginTop: 4 },
  modeSwitch: { flexDirection: 'row', backgroundColor: colors.primaryPale, borderRadius: 4, padding: 4, marginBottom: 9 },
  modeButton: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  selectedModeButton: { backgroundColor: colors.surface },
  modeText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  selectedModeText: { color: colors.primaryDark },
  valueButton: { minHeight: 52, borderRadius: 5, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center' },
  valueText: { flex: 1, color: colors.ink, fontSize: 14, lineHeight: 20 },
  placeholder: { color: colors.muted },
  chevron: { color: colors.primary, fontSize: 24, marginLeft: 10 },
  textInput: { minHeight: 52, borderRadius: 5, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 15, color: colors.ink, fontSize: 14 },
  detailField: { marginTop: 13 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(16, 37, 42, 0.42)' },
  sheet: { maxHeight: '86%', backgroundColor: colors.background, borderTopLeftRadius: 7, borderTopRightRadius: 7, paddingHorizontal: 20, paddingTop: 21, paddingBottom: 28 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  sheetTitle: { color: colors.ink, fontSize: 19, fontWeight: '800' },
  sheetHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 5 },
  closeButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.ink, fontSize: 23, lineHeight: 26 },
  breadcrumbScroll: { flexGrow: 0, marginBottom: 10 },
  breadcrumbRow: { flexDirection: 'row', alignItems: 'center' },
  crumbPart: { flexDirection: 'row', alignItems: 'center' },
  crumbButton: { paddingVertical: 8, paddingHorizontal: 3 },
  crumbText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  activeCrumb: { color: colors.primaryDark, fontWeight: '800' },
  crumbDivider: { color: colors.muted, marginHorizontal: 5 },
  chooseCurrentButton: { minHeight: 43, backgroundColor: colors.primaryPale, borderRadius: 4, alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  chooseCurrentText: { color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  listHeading: { color: colors.ink, fontSize: 13, fontWeight: '800', marginBottom: 8 },
  optionsList: { flexGrow: 0, minHeight: 110 },
  optionRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: 3 },
  optionName: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  optionAction: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  emptyText: { color: colors.muted, fontSize: 13, paddingVertical: 18, textAlign: 'center' },
});
