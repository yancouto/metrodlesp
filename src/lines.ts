export type LineId = string; // numeric string: '1', '2', '15'
export interface Line {
	id: LineId;
	name: string;
	color: string;
}

// Source of truth for supported lines in the app
export const LINES: Record<string, Line> = {
	"1": { id: "1", name: "Linha 1-Azul", color: "#00529f" },
	"2": { id: "2", name: "Linha 2-Verde", color: "#008061" },
	"3": { id: "3", name: "Linha 3-Vermelha", color: "#ee4034" },
	"4": { id: "4", name: "Linha 4-Amarela", color: "#fed400" },
	"5": { id: "5", name: "Linha 5-Lilás", color: "#794d9e" },
	"7": { id: "7", name: "Linha 7-Rubi", color: "#9f1765" },
	"8": { id: "8", name: "Linha 8-Diamante", color: "#9e9e93" },
	"9": { id: "9", name: "Linha 9-Esmeralda", color: "#00a78e" },
	"10": { id: "10", name: "Linha 10-Turquesa", color: "#007c8f" },
	"11": { id: "11", name: "Linha 11-Coral", color: "#f04e22" },
	"12": { id: "12", name: "Linha 12-Safira", color: "#023e88" },
	"13": { id: "13", name: "Linha 13-Jade", color: "#00ab5a" },
	"15": { id: "15", name: "Linha 15-Prata", color: "#848c8f" },
};
