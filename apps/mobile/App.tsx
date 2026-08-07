import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { DEFAULT_CARE_TARGETS } from "../../packages/shared/src/clinical";

export default function App() {
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.title}>Diabetes Coaching</Text>
    <Text style={styles.subtitle}>Auckland · local-first coaching companion</Text>
    <View style={styles.card}><Text style={styles.cardTitle}>Safety first</Text><Text>This app supports your agreed care plan. It cannot diagnose, change medicine, or manage emergencies. If you feel very unwell or are worried, seek urgent local care.</Text></View>
    <View style={styles.card}><Text style={styles.cardTitle}>Your current target context</Text><Text>Fasting {DEFAULT_CARE_TARGETS.fastingMinMmolL}–{DEFAULT_CARE_TARGETS.fastingMaxMmolL} mmol/L · after meals under {DEFAULT_CARE_TARGETS.postprandialMaxMmolL} mmol/L · HbA1c generally ≤ {DEFAULT_CARE_TARGETS.hba1cMaxMmolMol} mmol/mol</Text><Text style={styles.muted}>Confirm these with your clinician before relying on them.</Text></View>
    <View style={styles.card}><Text style={styles.cardTitle}>Coming next</Text><Text>On-device glucose logs, reliable offline reminders, and a photo-to-chat grocery shelf review.</Text></View>
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: "#F7FAF8" }, content: { padding: 24, gap: 16 }, title: { fontSize: 30, fontWeight: "700", color: "#12372A" }, subtitle: { color: "#426458" }, card: { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 16, gap: 8 }, cardTitle: { fontWeight: "700", fontSize: 17 }, muted: { color: "#5B6C65", fontSize: 13 } });
