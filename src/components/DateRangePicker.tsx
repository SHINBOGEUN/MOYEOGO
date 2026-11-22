import { useEffect, useMemo, useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

function dayNumber(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatDate(date: Date | null) {
  if (!date) return '날짜 선택';
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

export function formatDateRange(startDate: Date, endDate: Date) {
  const format = (date: Date) => `${date.getFullYear()}. ${String(date.getMonth() + 1).padStart(2, '0')}. ${String(date.getDate()).padStart(2, '0')}.`;
  return `${format(startDate)} - ${format(endDate)}`;
}

export function DateRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}: {
  startDate: Date | null;
  endDate: Date | null;
  onStartDateChange: (date: Date) => void;
  onEndDateChange: (date: Date) => void;
}) {
  const [visible, setVisible] = useState(false);

  const openCalendar = () => {
    Keyboard.dismiss();
    setVisible(true);
  };

  const confirmRange = (start: Date, end: Date) => {
    onStartDateChange(start);
    onEndDateChange(end);
    setVisible(false);
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>여행 날짜</Text>
      <Pressable
        onPress={openCalendar}
        style={styles.dateRangeButton}
        accessibilityRole="button"
        accessibilityLabel={startDate && endDate ? `여행 날짜 ${formatDate(startDate)}부터 ${formatDate(endDate)}` : '여행 날짜 범위 선택'}
      >
        <View style={styles.dateRangeIcon}>
          <Text style={styles.dateRangeIconText}>▦</Text>
        </View>
        <View style={styles.dateRangeTextWrap}>
          <Text style={styles.dateRangeTitle}>{startDate && endDate ? '선택한 여행 기간' : '여행 날짜를 선택해 주세요'}</Text>
          <Text style={[styles.dateRangeValue, !(startDate && endDate) && styles.placeholder]}>
            {startDate && endDate ? `${formatDate(startDate)}  -  ${formatDate(endDate)}` : '시작일과 종료일을 한 번에 선택'}
          </Text>
        </View>
        <Text style={styles.dateRangeChevron}>›</Text>
      </Pressable>
      <CalendarRangeModal
        visible={visible}
        startDate={startDate}
        endDate={endDate}
        onCancel={() => setVisible(false)}
        onConfirm={confirmRange}
      />
    </View>
  );
}

function CalendarRangeModal({
  visible,
  startDate,
  endDate,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  startDate: Date | null;
  endDate: Date | null;
  onCancel: () => void;
  onConfirm: (start: Date, end: Date) => void;
}) {
  const [month, setMonth] = useState(() => {
    const initial = startDate ?? new Date();
    return new Date(initial.getFullYear(), initial.getMonth(), 1);
  });
  const [draftStart, setDraftStart] = useState<Date | null>(startDate);
  const [draftEnd, setDraftEnd] = useState<Date | null>(endDate);

  useEffect(() => {
    if (!visible) return;
    const initial = startDate ?? new Date();
    setMonth(new Date(initial.getFullYear(), initial.getMonth(), 1));
    setDraftStart(startDate);
    setDraftEnd(endDate);
  }, [visible, startDate, endDate]);

  const cells = useMemo(() => {
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const totalDays = new Date(year, monthIndex + 1, 0).getDate();
    const all: Array<Date | null> = Array.from({ length: new Date(year, monthIndex, 1).getDay() }, () => null);
    for (let day = 1; day <= totalDays; day += 1) all.push(new Date(year, monthIndex, day));
    while (all.length % 7 !== 0) all.push(null);
    return all;
  }, [month]);

  const monthLabel = `${month.getFullYear()}년 ${month.getMonth() + 1}월`;
  const hint = !draftStart ? '여행 시작일을 선택해 주세요' : !draftEnd ? '여행 종료일을 선택해 주세요' : '선택한 날짜 범위를 확인해 주세요';

  const selectDate = (date: Date) => {
    if (!draftStart || draftEnd) {
      setDraftStart(date);
      setDraftEnd(null);
      return;
    }
    if (dayNumber(date) < dayNumber(draftStart)) {
      setDraftEnd(draftStart);
      setDraftStart(date);
      return;
    }
    setDraftEnd(date);
  };

  const previousMonth = () => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1));
  const nextMonth = () => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1));
  const confirm = () => {
    if (draftStart && draftEnd) onConfirm(draftStart, draftEnd);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="닫기" />
        <View style={styles.calendarSheet}>
          <View style={styles.calendarHeader}>
            <View>
              <Text style={styles.calendarTitle}>여행 날짜</Text>
              <Text style={styles.calendarHint}>{hint}</Text>
            </View>
            <Pressable onPress={onCancel} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="닫기">
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          <View style={styles.monthHeader}>
            <Pressable onPress={previousMonth} style={styles.monthArrowButton} accessibilityRole="button" accessibilityLabel="이전 달">
              <Text style={styles.monthArrow}>‹</Text>
            </Pressable>
            <Text style={styles.monthLabel}>{monthLabel}</Text>
            <Pressable onPress={nextMonth} style={styles.monthArrowButton} accessibilityRole="button" accessibilityLabel="다음 달">
              <Text style={styles.monthArrow}>›</Text>
            </Pressable>
          </View>

          <View style={styles.weekdays}>
            {['일', '월', '화', '수', '목', '금', '토'].map((weekday) => (
              <Text key={weekday} style={styles.weekday}>{weekday}</Text>
            ))}
          </View>

          <ScrollView contentContainerStyle={styles.calendarScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.daysGrid}>
              {cells.map((date, index) => {
                if (!date) return <View key={`blank-${index}`} style={styles.dayCell} />;
                const day = dayNumber(date);
                const startSelected = draftStart !== null && dayNumber(draftStart) === day;
                const endSelected = draftEnd !== null && dayNumber(draftEnd) === day;
                const rangeStart = draftStart && draftEnd ? Math.min(dayNumber(draftStart), dayNumber(draftEnd)) : null;
                const rangeEnd = draftStart && draftEnd ? Math.max(dayNumber(draftStart), dayNumber(draftEnd)) : null;
                const inRange = rangeStart !== null && rangeEnd !== null && day >= rangeStart && day <= rangeEnd;
                const rangeStartCell = inRange && day === rangeStart;
                const rangeEndCell = inRange && day === rangeEnd;
                const selected = startSelected || endSelected;
                const selectedLabel = startSelected ? '시작일' : endSelected ? '종료일' : '';
                return (
                  <View
                    key={date.toISOString()}
                    style={[
                      styles.dayCell,
                      inRange && styles.inRangeCell,
                      rangeStartCell && styles.rangeStartCell,
                      rangeEndCell && styles.rangeEndCell,
                    ]}
                  >
                    <Pressable
                      onPress={() => selectDate(date)}
                      style={[styles.dayButton, selected && styles.selectedDayButton]}
                      accessibilityRole="button"
                      accessibilityLabel={`${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일${selectedLabel ? `, ${selectedLabel}` : ''}`}
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.dayText, selected && styles.selectedDayText]}>{date.getDate()}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </ScrollView>

          <Text style={styles.rangeSummary}>
            {draftStart ? formatDate(draftStart) : '시작일'}  -  {draftEnd ? formatDate(draftEnd) : '종료일'}
          </Text>
          <View style={styles.calendarActions}>
            <Pressable onPress={onCancel} style={styles.cancelButton} accessibilityRole="button">
              <Text style={styles.cancelButtonText}>취소</Text>
            </Pressable>
            <Pressable
              onPress={confirm}
              disabled={!draftStart || !draftEnd}
              style={[styles.confirmButton, (!draftStart || !draftEnd) && styles.disabledConfirmButton]}
              accessibilityRole="button"
            >
              <Text style={styles.confirmButtonText}>이 기간으로 선택</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 17 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700', marginBottom: 8, marginTop: 4 },
  dateRangeButton: { minHeight: 76, borderRadius: 5, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' },
  dateRangeIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primaryPale, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  dateRangeIconText: { color: colors.primaryDark, fontSize: 21, fontWeight: '800' },
  dateRangeTextWrap: { flex: 1 },
  dateRangeTitle: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  dateRangeValue: { color: colors.primaryDark, fontSize: 12, fontWeight: '600', marginTop: 5 },
  dateRangeChevron: { color: colors.muted, fontSize: 25, marginLeft: 8 },
  placeholder: { color: colors.muted },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(16, 37, 42, 0.42)' },
  calendarSheet: { maxHeight: '90%', backgroundColor: colors.background, borderTopLeftRadius: 7, borderTopRightRadius: 7, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 26 },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  calendarTitle: { color: colors.ink, fontSize: 19, fontWeight: '800' },
  calendarHint: { color: colors.muted, fontSize: 12, marginTop: 4 },
  closeButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.ink, fontSize: 23, lineHeight: 26 },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 7 },
  monthArrowButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: colors.surface },
  monthArrow: { color: colors.primaryDark, fontSize: 27, lineHeight: 30 },
  monthLabel: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  weekdays: { flexDirection: 'row', marginBottom: 5 },
  weekday: { width: `${100 / 7}%`, color: colors.muted, textAlign: 'center', fontSize: 12, fontWeight: '700', paddingVertical: 7 },
  calendarScroll: { paddingBottom: 5 },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: `${100 / 7}%`, height: 45, alignItems: 'center', justifyContent: 'center' },
  inRangeCell: { backgroundColor: colors.primaryPale },
  rangeStartCell: { borderTopLeftRadius: 23, borderBottomLeftRadius: 23 },
  rangeEndCell: { borderTopRightRadius: 23, borderBottomRightRadius: 23 },
  dayButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  selectedDayButton: { backgroundColor: colors.primary },
  dayText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  selectedDayText: { color: '#FFFFFF', fontWeight: '800' },
  rangeSummary: { color: colors.primaryDark, fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 10 },
  calendarActions: { flexDirection: 'row', gap: 9, marginTop: 15 },
  cancelButton: { minHeight: 48, flex: 1, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  cancelButtonText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  confirmButton: { minHeight: 48, flex: 2, borderRadius: 5, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  disabledConfirmButton: { opacity: 0.42 },
  confirmButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
});
