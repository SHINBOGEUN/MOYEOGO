import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import type { TripPhoto } from '../domain/models';
import { coordinatesFromExif } from '../domain/photoLocation';
import { getTripCoverPhoto } from '../domain/tripCoverPhoto';
import { appendTripPhotos, copyTripPhotoBatch, removeTripPhoto, TripPhotoBatchError } from '../data/localGroupPhotos';
import { styles } from './TripPhotos.styles';

export function TripPhotos({ tripId, photos, coverPhotoId, onChange, onCoverPhotoChange, onAddPhotos, onRemovePhoto }: {
  tripId: string;
  photos: TripPhoto[];
  coverPhotoId?: string;
  onChange: (update: (current: TripPhoto[]) => TripPhoto[]) => void;
  onCoverPhotoChange: (photoId?: string) => void | Promise<void>;
  onAddPhotos?: (photos: TripPhoto[]) => void | Promise<void>;
  /** Return false to keep the photo visible when a remote deletion fails. */
  onRemovePhoto?: (photo: TripPhoto) => void | boolean | Promise<void | boolean>;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const coverPhoto = getTripCoverPhoto(photos, coverPhotoId);

  const addPhotos = async () => {
    if (isAdding) return;
    setIsAdding(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 20,
        quality: 0.9,
        exif: true,
      });
      if (result.canceled) return;

      const directory = new Directory(Paths.document, 'moyeogo-trip-photos', tripId);
      directory.create({ intermediates: true, idempotent: true });
      const nextPhotos = await copyTripPhotoBatch(result.assets, async (asset) => {
        const id = Math.random().toString(36).slice(2, 10);
        const extension = (asset.fileName?.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? asset.uri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)?.[1] ?? 'jpg').toLowerCase();
        const destination = new File(directory, `${id}.${extension}`);
        const coordinates = coordinatesFromExif(asset.exif);
        await new File(asset.uri).copy(destination);
        const photo: TripPhoto = {
          id,
          uri: destination.uri,
          addedAt: new Date().toISOString(),
          ...(coordinates ?? {}),
        };
        return { value: photo, uri: destination.uri };
      }, (uri) => new File(uri).delete());
      if (nextPhotos.length) {
        onChange((current) => appendTripPhotos(current, nextPhotos));
        await onAddPhotos?.(nextPhotos);
      }
      const located = nextPhotos.filter((photo) => photo.latitude !== undefined).length;
      if (nextPhotos.length && located < nextPhotos.length) {
        Alert.alert('사진을 추가했어요', `위치 정보가 없는 사진 ${nextPhotos.length - located}장은 여행 사진에 저장하고 지도에는 표시하지 않았어요.`);
      }
    } catch (error) {
      const cleanupFailures = error instanceof TripPhotoBatchError ? error.cleanupFailures : 0;
      Alert.alert(
        '사진을 추가하지 못했어요',
        cleanupFailures
          ? `일부 파일을 정리하지 못했어요(${cleanupFailures}개). 기기의 사진 폴더를 확인한 뒤 다시 시도해 주세요.`
          : '사진을 다시 선택해 주세요.',
      );
    } finally {
      setIsAdding(false);
    }
  };

  const removePhoto = (photo: TripPhoto) => {
    Alert.alert('사진을 삭제할까요?', '여행 기록에서 이 사진을 삭제합니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => { void (async () => {
          try {
            const mayRemoveLocally = await onRemovePhoto?.(photo);
            if (mayRemoveLocally === false) return;
            onChange((current) => removeTripPhoto(current, photo.id));
            if (coverPhoto?.id === photo.id) await onCoverPhotoChange(undefined);
            if (photo.uri.startsWith(Paths.document.uri) || photo.uri.startsWith(Paths.cache.uri)) {
              try { new File(photo.uri).delete(); } catch {
                Alert.alert('기기 파일 정리 실패', '여행에서는 사진을 삭제했지만 기기에 남은 사진 파일은 정리하지 못했어요.');
              }
            }
          } catch {
            Alert.alert('사진을 삭제하지 못했어요', '삭제를 완료하지 못해 여행 목록에 그대로 두었어요. 다시 시도해 주세요.');
          }
        })(); },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.title}>여행 사진</Text>
          <Text style={styles.note}>위치 정보는 지도에 표시돼요. 대표를 설정하지 않으면 첫 사진을 보여줘요.</Text>
        </View>
        <Pressable style={styles.addButton} onPress={addPhotos} disabled={isAdding} accessibilityRole="button">
          <Text style={styles.addButtonText}>{isAdding ? '불러오는 중' : '사진 추가'}</Text>
        </Pressable>
      </View>
      {photos.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>아직 추가한 사진이 없어요</Text>
          <Text style={styles.emptyText}>휴대폰 사진을 골라 여행 기록에 남겨 보세요.</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoList}>
          {photos.map((photo) => (
            <View key={photo.id} style={styles.photoCard}>
              <Image source={{ uri: photo.uri }} style={styles.photo} />
              {coverPhoto?.id === photo.id ? (
                <View style={styles.coverBadge}><Text style={styles.coverBadgeText}>대표 사진</Text></View>
              ) : null}
              <Pressable style={styles.removeButton} onPress={() => removePhoto(photo)} accessibilityRole="button" accessibilityLabel="사진 삭제">
                <Text style={styles.removeButtonText}>×</Text>
              </Pressable>
              <Text style={styles.photoLocation} numberOfLines={1}>
                {photo.latitude !== undefined && photo.longitude !== undefined ? `${photo.latitude.toFixed(3)}, ${photo.longitude.toFixed(3)}` : '위치 정보 없음'}
              </Text>
              <Text style={styles.photoDate}>{new Date(photo.addedAt).toLocaleDateString('ko-KR')}</Text>
              {coverPhoto?.id === photo.id ? (
                <Text style={styles.coverSelected}>대표로 표시 중</Text>
              ) : (
                <Pressable style={styles.setCoverButton} onPress={() => onCoverPhotoChange(photo.id)} accessibilityRole="button">
                  <Text style={styles.setCoverButtonText}>대표로 설정</Text>
                </Pressable>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
