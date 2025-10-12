export type LineId = string; // numeric string: '1', '2', '15'
export interface Line { id: LineId; name: string; color: string; }

// Source of truth for supported lines in the app
export const LINES: Record<string, Line> = {
  '1': { id: '1', name: 'Linha 1-Azul', color: '#0033a0' },
  '2': { id: '2', name: 'Linha 2-Verde', color: '#00a651' },
  '3': { id: '3', name: 'Linha 3-Vermelha', color: '#ee3124' },
  '4': { id: '4', name: 'Linha 4-Amarela', color: '#ffc20e' },
  '5': { id: '5', name: 'Linha 5-Lilás', color: '#7f3f98' },
  '7': { id: '7', name: 'Linha 7-Rubi', color: '#c21807' },
  '8': { id: '8', name: 'Linha 8-Diamante', color: '#8e8e8e' },
  '9': { id: '9', name: 'Linha 9-Esmeralda', color: '#0f9d58' },
  '10': { id: '10', name: 'Linha 10-Turquesa', color: '#30c6d9' },
  '11': { id: '11', name: 'Linha 11-Coral', color: '#ff7f50' },
  '12': { id: '12', name: 'Linha 12-Safira', color: '#26619c' },
  '13': { id: '13', name: 'Linha 13-Jade', color: '#00a86b' },
  '15': { id: '15', name: 'Linha 15-Prata', color: '#c0c0c0' },
};
