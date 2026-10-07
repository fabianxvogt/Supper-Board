'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { domainDecimal, parseAmount } from '@/domain/amounts';
import { getProfileReferenceValues, resolveReferenceTarget } from '@/domain/references';
import { validateLocalDate } from '@/domain/dates';
import type { NutrientTarget, ProfileInput } from '@/domain/types';
import { getWorkspaceContext } from '@/app/workspace/context';
import { localToday } from '@/app/workspace/format';
import { mutationErrorMessage } from '@/app/workspace/mutation-error';
import type { ReferenceAdoptionState } from '@/features/profile/ReferenceAdoptionForm';

const uuid = z.uuid();
const operationId = z.uuid();
const contextSchema = z.enum(['standard_adult', 'child', 'older_adult', 'pregnancy', 'lactation', 'clinical', 'performance', 'other']);
const groupSchema = z.enum(['male', 'female']);

function stringValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function optionalAmount(value: string): string | undefined {
  if (!value) return undefined;
  const amount = parseAmount(value);
  if (domainDecimal(amount).isNegative()) throw new Error('Mengen dürfen nicht negativ sein.');
  return amount;
}

function stringList(value: string): Array<{ value: string }> {
  return value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 80).map((item) => ({ value: item }));
}

export async function savePrivateProfileAction(_state: { error?: string; message?: string; savedOperationId?: string }, formData: FormData) {
  const input = z.object({
    operationId,
    personId: uuid,
    profileId: uuid.optional(),
    expectedRevision: z.string().optional(),
    birthDate: z.string().optional(),
    ageYears: z.string().optional(),
    ageAsOfDate: z.string().optional(),
    heightCm: z.string().optional(),
    weightKg: z.string().optional(),
    weightMeasuredOn: z.string().optional(),
    activityDescription: z.string().max(1500).optional(),
    pal: z.string().optional(),
    sourceCalculationGroup: z.union([groupSchema, z.literal('')]).optional(),
    referenceContext: contextSchema,
    nutritionMode: z.enum(['view', 'manual', 'guided']),
    shareTargetsWithHousehold: z.string().optional(),
    preferences: z.string().max(1000).optional(),
    exclusions: z.string().max(1000).optional(),
  }).safeParse({
    operationId: formData.get('operationId'),
    personId: formData.get('personId'),
    profileId: stringValue(formData, 'profileId') || undefined,
    expectedRevision: stringValue(formData, 'expectedRevision') || undefined,
    birthDate: stringValue(formData, 'birthDate') || undefined,
    ageYears: stringValue(formData, 'ageYears') || undefined,
    ageAsOfDate: stringValue(formData, 'ageAsOfDate') || undefined,
    heightCm: stringValue(formData, 'heightCm') || undefined,
    weightKg: stringValue(formData, 'weightKg') || undefined,
    weightMeasuredOn: stringValue(formData, 'weightMeasuredOn') || undefined,
    activityDescription: stringValue(formData, 'activityDescription') || undefined,
    pal: stringValue(formData, 'pal') || undefined,
    sourceCalculationGroup: stringValue(formData, 'sourceCalculationGroup'),
    referenceContext: formData.get('referenceContext'),
    nutritionMode: formData.get('nutritionMode'),
    shareTargetsWithHousehold: formData.get('shareTargetsWithHousehold') === 'true' ? 'true' : 'false',
    preferences: stringValue(formData, 'preferences'),
    exclusions: stringValue(formData, 'exclusions'),
  });
  if (!input.success) return { error: 'Bitte prüfe Profilkontext, Datum und Eingabewerte.' };


  try {
    const context = await getWorkspaceContext();
    const person = context.persons.find((candidate) => candidate.id === input.data.personId);
    if (!person || context.activePerson?.id !== person.id) return { error: 'Wähle zuerst das private Profil aus, das du bearbeiten möchtest.' };
    const current = await context.repository.getPrivateProfile(person.id);
    if (person.linkedUserId !== context.user.id && !(person.linkedUserId === null && current?.ownerUserId === context.user.id)) return { error: 'Private Daten können nur für die eigene verknüpfte Person oder ein bereits eigenes importiertes Profil gespeichert werden.' };
    if (current && current.ownerUserId !== context.user.id) return { error: 'Dieses private Profil gehört einem anderen Haushaltsmitglied.' };
    if (input.data.profileId && current?.profileId !== input.data.profileId) return { error: 'Das private Profil wurde inzwischen geändert oder ist nicht mehr verfügbar.' };
    if (!current && input.data.profileId) return { error: 'Das private Profil ist nicht mehr verfügbar.' };
    if (current && Number(input.data.expectedRevision) !== current.revision) return { error: 'Seit dem Laden wurde das private Profil geändert. Lade den aktuellen Stand, bevor du erneut speicherst.' };
    const birthDate = input.data.birthDate ? validateLocalDate(input.data.birthDate, 'birthDate') : undefined;
    const ageAsOfDate = input.data.ageAsOfDate ? validateLocalDate(input.data.ageAsOfDate, 'ageAsOfDate') : undefined;
    const weightMeasuredOn = input.data.weightMeasuredOn ? validateLocalDate(input.data.weightMeasuredOn, 'weightMeasuredOn') : undefined;
    const ageYears = input.data.ageYears ? Number(input.data.ageYears) : undefined;
    if (ageYears !== undefined && (!Number.isSafeInteger(ageYears) || ageYears < 0 || ageYears > 130)) return { error: 'Das Alter muss eine bestätigte ganze Zahl von 0 bis 130 Jahren sein.' };
    if (birthDate && ageYears !== undefined) return { error: 'Nutze entweder Geburtsdatum oder bestätigtes Alter mit Bezugsdatum, nicht beides.' };
    if ((ageYears === undefined) !== (ageAsOfDate === undefined)) return { error: 'Bestätigtes Alter und Bezugsdatum müssen gemeinsam angegeben oder entfernt werden.' };
    const today = localToday(context.household.timeZone);
    if ([birthDate, ageAsOfDate, weightMeasuredOn].some((date) => date && date > today)) return { error: 'Geburts-, Bezugs- und Messdaten dürfen nicht in der Zukunft liegen.' };
    const weightKg = optionalAmount(input.data.weightKg ?? '') ?? null;
    if ((weightKg === null) !== (weightMeasuredOn === undefined)) return { error: 'Gewicht und Messdatum müssen gemeinsam angegeben oder entfernt werden.' };
    const result = await context.repository.savePrivateProfile({
      operationId: input.data.operationId,
      expectedRevisions: current ? { [current.profileId]: current.revision } : { new: null },
      payload: {
        personId: person.id,
        profileId: current?.profileId,
        birthDate: birthDate ?? null,
        ageYears: ageYears ?? null,
        ageAsOfDate: ageAsOfDate ?? null,
        heightCm: optionalAmount(input.data.heightCm ?? '') ?? null,
        weightKg,
        weightMeasuredOn: weightMeasuredOn ?? null,
        activityDescription: input.data.activityDescription || null,
        sourceCalculationGroup: input.data.sourceCalculationGroup || null,
        referenceContext: input.data.referenceContext,
        pal: optionalAmount(input.data.pal ?? '') ?? null,
        preferences: stringList(input.data.preferences ?? ''),
        exclusions: stringList(input.data.exclusions ?? ''),
        shareTargetsWithHousehold: input.data.shareTargetsWithHousehold === 'true',
        nutritionMode: input.data.nutritionMode,
      },
    });
    revalidatePath('/profile');
    return { savedOperationId: result.operationId, profileId: result.result.profileId, profileRevision: result.revisions[result.result.profileId], message: 'Privates Profil gespeichert.' };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Das private Profil wurde nicht gespeichert. Deine Eingaben sind noch vorhanden.') };
  }
}

interface TargetFormInput {
  nutrientCode: string;
  unit: string;
  targetKind: 'point' | 'range' | 'minimum' | 'maximum';
  pointValue?: string;
  minimum?: string;
  maximum?: string;
  manuallyLocked: boolean;
  origin: 'manual' | 'adopted_reference' | 'professional_entered';
}

function targetRows(formData: FormData): TargetFormInput[] | null {
  const count = Number(formData.get('targetCount'));
  if (!Number.isInteger(count) || count < 1 || count > 200) return null;
  const targets: TargetFormInput[] = [];
  for (let index = 0; index < count; index += 1) {
    const input = z.object({
      nutrientCode: z.string().trim().min(1).max(80),
      unit: z.string().trim().min(1).max(32),
      targetKind: z.enum(['point', 'range', 'minimum', 'maximum']),
      pointValue: z.string().optional(),
      minimum: z.string().optional(),
      maximum: z.string().optional(),
      manuallyLocked: z.enum(['true', 'false']),
      origin: z.enum(['manual', 'adopted_reference', 'professional_entered']),
    }).safeParse({
      nutrientCode: formData.get(`target.${index}.nutrientCode`),
      unit: formData.get(`target.${index}.unit`),
      targetKind: formData.get(`target.${index}.targetKind`),
      pointValue: formData.get(`target.${index}.pointValue`) || undefined,
      minimum: formData.get(`target.${index}.minimum`) || undefined,
      maximum: formData.get(`target.${index}.maximum`) || undefined,
      manuallyLocked: formData.get(`target.${index}.manuallyLocked`),
      origin: formData.get(`target.${index}.origin`),
    });
    if (!input.success) return null;
    targets.push({ ...input.data, manuallyLocked: input.data.manuallyLocked === 'true' });
  }
  return targets;
}

export async function saveManualTargetVersionAction(_state: { error?: string; message?: string; savedOperationId?: string }, formData: FormData) {
  const input = z.object({ operationId, profileId: uuid, baseVersionId: z.union([z.literal(''), uuid]), expectedRevision: z.coerce.number().int().nonnegative(), validFrom: z.string() }).safeParse({ operationId: formData.get('operationId'), profileId: formData.get('profileId'), baseVersionId: formData.get('baseVersionId') ?? '', expectedRevision: formData.get('expectedRevision'), validFrom: formData.get('validFrom') });
  const targets = targetRows(formData);
  if (!input.success || !targets) return { error: 'Prüfe alle manuellen Zielwerte, Einheiten und Zielarten.' };
  if (targets.some((target) => target.nutrientCode.toLowerCase() === 'fiber')) return { error: 'Für Ballaststoffe ist nur die registrierte Kennung dietary_fiber gültig.' };
  try {
    const context = await getWorkspaceContext();
    if (!context.activePerson) return { error: 'Wähle zuerst dein eigenes Profil aus.' };
    const profile = await context.repository.getPrivateProfile(context.activePerson.id, localToday(context.household.timeZone));
    if (!profile || profile.profileId !== input.data.profileId || profile.ownerUserId !== context.user.id) return { error: 'Manuelle Ziele sind nur für das eigene private Profil verfügbar.' };
    if (profile.revision !== input.data.expectedRevision) return { error: 'Das Profil wurde inzwischen geändert. Lade den aktuellen Stand, bevor du Ziele speicherst.' };
    const validFrom = validateLocalDate(input.data.validFrom);
    const existing = await context.repository.getProfileTargets(profile.profileId, localToday(context.household.timeZone));
    const base = input.data.baseVersionId ? existing.history.find((version) => version.id === input.data.baseVersionId) : null;
    if (input.data.baseVersionId && !base) return { error: 'Die bearbeitete Zielversion ist nicht mehr verfügbar. Lade den aktuellen Stand.' };
    const items = targets.map((target) => ({
      nutrientCode: target.nutrientCode,
      unit: target.unit,
      targetKind: target.targetKind,
      pointValue: target.targetKind === 'point' ? optionalAmount(target.pointValue ?? '') : undefined,
      minimum: target.targetKind === 'range' || target.targetKind === 'minimum' ? optionalAmount(target.minimum ?? '') : undefined,
      maximum: target.targetKind === 'range' || target.targetKind === 'maximum' ? optionalAmount(target.maximum ?? '') : undefined,
      manuallyLocked: target.manuallyLocked,
      origin: target.origin,
    })).map((item) => {
      const previous = base?.targets.find((target) => target.nutrientId === item.nutrientCode);
      if (!previous) return item;
      const prior = targetPreview(previous);
      const unchanged = prior.unit === item.unit && prior.targetKind === item.targetKind
        && prior.pointValue === item.pointValue && prior.minimum === item.minimum && prior.maximum === item.maximum && prior.origin === item.origin;
      return unchanged
        ? { ...targetVersionItem(previous), manuallyLocked: item.manuallyLocked }
        : item;
    });
    if (items.some((item) => item.origin === 'adopted_reference' && (!('referenceValueId' in item) || !item.referenceValueId))) return { error: 'Geänderte Referenzziele müssen manuell gekennzeichnet oder über die geprüfte Referenzvorschau neu übernommen werden.' };
    for (const [index, item] of items.entries()) {
      if (item.targetKind === 'point' && item.pointValue === undefined) return { error: `Ziel ${index + 1}: ein Punktwert ist erforderlich.` };
      if (item.targetKind === 'range' && (item.minimum === undefined || item.maximum === undefined || domainDecimal(item.minimum).greaterThan(item.maximum))) return { error: `Ziel ${index + 1}: der Zielbereich muss zwei gültige Grenzen enthalten.` };
      if (item.targetKind === 'minimum' && item.minimum === undefined) return { error: `Ziel ${index + 1}: ein Minimum ist erforderlich.` };
      if (item.targetKind === 'maximum' && item.maximum === undefined) return { error: `Ziel ${index + 1}: eine Obergrenze ist erforderlich.` };
    }
    const result = await context.repository.saveTargetVersion({ operationId: input.data.operationId, expectedRevisions: { [input.data.profileId]: profile.revision }, payload: { profileId: input.data.profileId, baseVersionId: base?.id ?? null, validFrom, origin: 'manual', items } });
    return { savedOperationId: result.operationId, targetVersionId: result.result.targetVersionId, profileRevision: result.revisions[profile.profileId], message: 'Neue Zielversion gespeichert.' };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Die Zielversion wurde nicht gespeichert.') };
  }
}

function targetPreview(target: NutrientTarget) {
  return {
    nutrientCode: target.nutrientId,
    unit: target.unit,
    targetKind: target.type,
    pointValue: target.type === 'point' ? target.amount : undefined,
    minimum: target.type === 'range' || target.type === 'minimum' ? target.minimum ?? target.amount : undefined,
    maximum: target.type === 'range' || target.type === 'maximum' ? target.maximum ?? target.amount : undefined,
    manuallyLocked: target.locked ?? false,
    origin: target.origin,
  };
}
function adoptionTargetSnapshot(target: NutrientTarget) {
  return { ...targetPreview(target), isImportedUnverified: target.isImportedUnverified === true, referenceKey: target.referenceId ?? null, referenceInputs: target.referenceInputs ?? {} };
}

function targetVersionItem(target: NutrientTarget) {
  return {
    ...targetPreview(target),
    origin: target.origin,
    referencePackId: target.referencePackId ?? undefined,
    referenceValueId: target.referenceValueId ?? undefined,
    referenceInputs: target.referenceInputs ?? {},
  };
}

export async function adoptReferenceTargetAction(_state: ReferenceAdoptionState, formData: FormData): Promise<ReferenceAdoptionState> {
  const input = z.object({
    operationId,
    profileId: uuid,
    profileRevision: z.coerce.number().int().nonnegative(),
    referenceId: z.string().trim().min(1).max(160),
    mode: z.enum(['preview', 'confirm']).default('preview'),
    planningEnergyKcal: z.string().trim().max(40).optional(),
    unlockLocked: z.enum(['true', 'false']).default('false'),
    expectedTargetVersionId: z.union([uuid, z.literal('')]).default(''),
    expectedCalculationDate: z.string().optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: 'Der gewählte Referenzwert oder die Bestätigung ist ungültig.' };
  const context = await getWorkspaceContext();
  if (!context.activePerson) return { error: 'Wähle zuerst dein eigenes Profil aus.' };
  const today = localToday(context.household.timeZone);
  const privateProfile = await context.repository.getPrivateProfile(context.activePerson.id, today);
  if (!privateProfile || privateProfile.profileId !== input.data.profileId || privateProfile.ownerUserId !== context.user.id) return { error: 'Referenzwerte können nur als Ziel des eigenen privaten Profils übernommen werden.' };
  if (privateProfile.revision !== input.data.profileRevision) return { error: 'Das Profil wurde geändert. Lade die Referenzen neu, bevor du einen Wert übernimmst.' };
  try {
    const profile: ProfileInput = { ...privateProfile.profile, calculationDate: today };
    if (input.data.mode === 'confirm' && input.data.expectedCalculationDate !== profile.calculationDate) {
      return { error: 'Der lokale Referenzstichtag hat sich geändert. Erstelle die Vorschau erneut.' };
    }
    const references = getProfileReferenceValues(profile);
    const reference = references.applicable.find((item) => item.id === input.data.referenceId);
    if (!reference) {
      const conditional = references.conditional.find((item) => item.value.id === input.data.referenceId);
      return { error: conditional ? `Dieser Wert bleibt deaktiviert: ${conditional.reason}` : 'Dieser Referenzwert ist für den aktuellen Profilkontext nicht verfügbar.' };
    }
    const referenceInputs: { confirmedWeightKg?: string; planningEnergyKcal?: string } = {};
    if (reference.type === 'per_kg') {
      const confirmedWeightKg = profile.weightKg;
      if (confirmedWeightKg == null) return { error: 'Für die gewählte g/kg-Referenz fehlt eine bestätigte Gewichtsgrundlage.' };
      referenceInputs.confirmedWeightKg = domainDecimal(confirmedWeightKg).toString();
    } else if (reference.type === 'energy_percent' && input.data.planningEnergyKcal) {
      referenceInputs.planningEnergyKcal = domainDecimal(input.data.planningEnergyKcal).toString();
    }
    const resolved = resolveReferenceTarget(reference, referenceInputs);
    if (!resolved.available || !resolved.target) return { error: resolved.reason ?? 'Dieser Referenzwert kann nicht als Ziel übernommen werden.' };
    const identity = await context.repository.getReferenceIdentity({ referencePackVersion: reference.referencePackVersion, immutableKey: reference.id });
    if (!identity) return { error: 'Die freigegebene Referenz besitzt keine passende, genehmigte Datenbankidentität und kann nicht übernommen werden.' };

    const targetVersions = await context.repository.getProfileTargets(privateProfile.profileId, today);
    const currentVersion = targetVersions.selected;
    const currentTarget = currentVersion?.targets.find((item) => item.nutrientId === resolved.target?.nutrientId) ?? null;
    const locked = currentTarget?.locked === true;
    const unlockLocked = input.data.unlockLocked === 'true';
    if (input.data.mode === 'confirm') {
      if ((currentVersion?.id ?? '') !== input.data.expectedTargetVersionId) return { error: 'Deine Zielversion wurde seit der Vorschau geändert. Prüfe die neue Vorschau, bevor du bestätigst.' };
      if (locked && !unlockLocked) return { error: 'Dieses Ziel ist manuell gesperrt. Entsperre es ausdrücklich in der Vorschau, um es zu ersetzen.' };
    }
    const target = resolved.target;
    const preview: ReferenceAdoptionState['preview'] = {
      calculationDate: today,
      expectedTargetVersionId: currentVersion?.id ?? '',
      reference: {
        nutrientCode: reference.nutrientId,
        type: reference.type,
        unit: reference.unit,
        amount: reference.amount,
        minimum: reference.minimum,
        maximum: reference.maximum,
        packVersion: reference.referencePackVersion,
        citation: reference.citation,
        conditions: reference.conditions,
      },
      target: adoptionTargetSnapshot(target),
      calculationInputs: referenceInputs,
      existingTarget: currentTarget ? adoptionTargetSnapshot(currentTarget) : null,
      existingTargetLocked: locked,
      preserveCount: (currentVersion?.targets.length ?? 0) - (currentTarget ? 1 : 0),
      preservedTargets: (currentVersion?.targets ?? []).filter((item) => item.nutrientId !== target.nutrientId).map(adoptionTargetSnapshot),
      comparisonNotice: reference.type === 'energy_percent' && !input.data.planningEnergyKcal
        ? 'Dieses E%-Ziel bleibt als Energieprozent gespeichert und wird nicht mit einer Grammmenge verglichen.'
        : reference.type === 'energy_percent'
          ? 'Die Grammumrechnung verwendet die ausdrücklich gewählte Planungsenergie, nicht gemessene Quellenergie.'
          : null,
    };
    if (input.data.mode === 'preview') return { preview };

    const mergedTargets = [
      ...(currentVersion?.targets ?? []).filter((item) => item.nutrientId !== target.nutrientId),
      target,
    ].sort((left, right) => left.nutrientId.localeCompare(right.nutrientId));
    const note = `${reference.referencePackVersion} · ${reference.citation}${target.calculationNote ? ` · ${target.calculationNote}` : ''}`;
    const result = await context.repository.saveTargetVersion({
      operationId: input.data.operationId,
      expectedRevisions: { [privateProfile.profileId]: privateProfile.revision },
      payload: {
        profileId: privateProfile.profileId,
        baseVersionId: currentVersion?.id ?? null,
        validFrom: profile.calculationDate,
        origin: 'adopted_reference',
        referencePackId: identity.referencePackId,
        note,
        items: mergedTargets.map((item) => item.nutrientId === target.nutrientId
          ? { ...targetVersionItem(item), origin: 'adopted_reference', referencePackId: identity.referencePackId, referenceValueId: identity.referenceValueId, referenceInputs, manuallyLocked: false }
          : targetVersionItem(item)),
      },
    });
    return { savedOperationId: result.operationId, message: `Übernommen: ${reference.nutrientId} · ${reference.citation}` };
  } catch (error) {
    return { error: mutationErrorMessage(error, 'Der Referenzwert wurde nicht als Ziel gespeichert.') };
  }
}
