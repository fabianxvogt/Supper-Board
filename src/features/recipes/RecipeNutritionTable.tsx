import { formatDecimal, nutrientLabel } from '@/app/workspace/format';
import type { RecipeCalculation } from '@/domain/types';

export function RecipeNutritionTable({ calculation, compact = false }: { calculation: RecipeCalculation; compact?: boolean }) {
  const nutrients = compact ? calculation.total.nutrients.slice(0, 12) : calculation.total.nutrients;
  return <div className="table-scroll"><table>
    <caption className="sr-only">Bekannte Nährwerte der ganzen Rezeptmenge und je Basisportion</caption>
    <thead><tr><th scope="col">Nährstoff</th><th scope="col">Gesamtes Rezept</th><th scope="col">Je Basisportion</th><th scope="col">Vollständigkeit</th></tr></thead>
    <tbody>{nutrients.map((nutrient) => {
      const portion = calculation.perPortion?.nutrients.find((item) => item.nutrientId === nutrient.nutrientId);
      const label = nutrientLabel(nutrient.nutrientId);
      return <tr key={nutrient.nutrientId}>
        <th scope="row">{label}</th>
        <td>{nutrient.knownAmount === null ? 'unbekannt' : `${formatDecimal(nutrient.knownAmount)} ${nutrient.unit}`}</td>
        <td>{portion?.knownAmount == null ? 'unbekannt' : `${formatDecimal(portion.knownAmount)} ${portion.unit}`}</td>
        <td>{nutrient.status === 'complete' ? 'Vollständig' : nutrient.knownAmount === null ? 'Unbekannt' : 'Bekannte Teilsumme'}
          <details><summary>Werte und offene Angaben</summary><p className="help">Exakte Gesamtsumme: {nutrient.knownAmount ?? 'unbekannt'} {nutrient.unit}<br />Exakt je Portion: {portion?.knownAmount ?? 'unbekannt'} {nutrient.unit}</p>{nutrient.missingReasons.length > 0 && <p className="help">Offene Berechnungsgrundlagen: {nutrient.missingReasons.join(', ')}</p>}<p className="help">Nährstoffkennung: {nutrient.nutrientId}</p></details>
        </td>
      </tr>;
    })}</tbody>
  </table></div>;
}
