import { BroadcastChunk, BroadcastFragment, DemoPacket, Registry } from '@mixednuts/demo';
import { BitBuffer } from '@mixednuts/demo/buffers';
import { EDemoCommands } from '@mixednuts/demo/gen/demo_pb';
import { NET_Messages } from '@mixednuts/demo/gen/networkbasetypes_pb';

// Data Models
export interface ChunkAnalysis {
	index: number;
	command: number;
	commandName: string;
	size: number;
	isCompressed: boolean;
	rawCommand: number;
	analysisType: 'network_packets' | 'protobuf' | 'spawn_groups' | 'unknown';
	success: boolean;
	error?: string;
	parseTimeMs: number;
	networkPackets?: NetworkPacketAnalysis[];
	protobufData?: any;
	rawDataSample?: {
		first20Bytes: string;
		last10Bytes: string;
	};
}

export interface NetworkPacketAnalysis {
	packetIndex: number;
	cursor: number;
	type: number;
	typeName: string;
	size: number;
	success: boolean;
	error?: string;
	parseTimeMs: number;
	remainingBytesAfter: number;
	rawDataSample?: string;
	decodedData?: any;
	decodeSuccess?: boolean;
	decodeError?: string;
	messageIndex?: number;
}

export interface DemoAnalysis {
	fragmentSize: number;
	totalChunks: number;
	totalParseTimeMs: number;
	chunks: ChunkAnalysis[];
	summary: {
		networkPacketChunks: number;
		protobufChunks: number;
		unknownChunks: number;
		totalNetworkPackets: number;
		errors: number;
		packetErrors: number;
		packetDecodeErrors: number;
	};
	performance: {
		averageChunkParseTimeMs: number;
		slowestChunk: {
			index: number;
			timeMs: number;
		};
		fastestChunk: {
			index: number;
			timeMs: number;
		};
	};
}

// Analysis Framework
export class DemoAnalyzer {
	// Message type registries imported from individual decoders
	private messageTypeRegistries = [
		Registry.NetMessageBase,
		Registry.NetMessage,
		Registry.UserMessage,
		Registry.CitadelUserMessage,
		Registry.GameEvent,
		Registry.TempEntity,
		Registry.CitadelGameEvent
	];

	resolveMessageTypeName(type: number): string {
		for (const registry of this.messageTypeRegistries) {
			for (const enumObj of registry.enums) {
				if (enumObj[type]) {
					return enumObj[type];
				}
			}
		}
		return 'unknown';
	}

	decodeNetworkPacket(
		type: number,
		data: Uint8Array
	): { success: boolean; data?: any; error?: string } {
		try {
			// Try each registered decoder in order
			for (const registry of this.messageTypeRegistries) {
				if (registry.isType(type)) {
					// @ts-expect-error
					return { success: true, data: registry.decode(type, data) };
				}
			}

			return { success: false, error: `Unknown message type: ${type}` };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	analyzeNetworkPackets(data: Uint8Array, index: number, command: number): NetworkPacketAnalysis[] {
		const packets: NetworkPacketAnalysis[] = [];
		const bitbuffer = BitBuffer.from(data);
		let packetIndex = 0;

		if (command === EDemoCommands.DEM_SpawnGroups) {
			const sequence = bitbuffer.read_uvarbit();
		}

		// Debug: examine raw data at start
		while (bitbuffer.remaining_bytes() > 0) {
			const packetStartTime = performance.now();
			const cursor = bitbuffer.cursor;
			const packet: NetworkPacketAnalysis = {
				packetIndex,
				cursor,
				type: 0,
				typeName: 'unknown',
				size: 0,
				success: false,
				parseTimeMs: 0, // Will be set at the end
				remainingBytesAfter: 0
			};

			try {
				// Check if we have enough bits for a packet type
				if (bitbuffer.remaining_bits() < 4) {
					packet.error = `Not enough bits for packet type (${bitbuffer.remaining_bits()} < 4)`;
					packets.push(packet);
					break;
				}

				// Read packet type
				packet.type = bitbuffer.read_uvarbit();
				packet.typeName = this.resolveMessageTypeName(packet.type);

				// Check for NOP
				if (packet.type === NET_Messages.net_NOP) {
					packet.success = true;
					packet.remainingBytesAfter = bitbuffer.remaining_bytes();
					packets.push(packet);
					packetIndex++;
					continue; // Continue parsing next packet instead of ending
				}

				// Read packet size
				packet.size = bitbuffer.read_uvarint32();

				// Validate size
				if (packet.size > bitbuffer.remaining_bytes()) {
					packet.error = `Size ${packet.size} > remaining bytes ${bitbuffer.remaining_bytes()}`;
					packets.push(packet);
					break;
				}

				// Read packet data

				const packetData = bitbuffer.read_bytes(packet.size);
				const packetDataHex = Array.from(packetData.slice(0, 10))
					.map((b) => b.toString(16).padStart(2, '0'))
					.join(' ');

				packet.rawDataSample = packetDataHex;

				// Try to decode the packet data
				const decodeResult = this.decodeNetworkPacket(packet.type, packetData);
				packet.decodeSuccess = decodeResult.success;
				packet.decodedData = decodeResult.data;
				packet.decodeError = decodeResult.error;

				packet.success = true;
				packet.remainingBytesAfter = bitbuffer.remaining_bytes();
				packets.push(packet);
			} catch (error) {
				packet.error = error instanceof Error ? error.message : String(error);
				packets.push(packet);
				break;
			}

			// Set packet parse time
			packet.parseTimeMs = performance.now() - packetStartTime;

			packetIndex++;
		}

		return packets;
	}

	analyzeProtobuf(
		command: number,
		data: Uint8Array
	): { success: boolean; data?: any; error?: string } {
		try {
			const message = Registry.DemoCommand.decode(command, data);
			return { success: true, data: message };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	analyzeChunk(chunk: BroadcastChunk, index: number): ChunkAnalysis {
		const chunkStartTime = performance.now();

		const { command, isCompressed } = chunk.header();
		const rawCommand = command | (isCompressed ? EDemoCommands.DEM_IsCompressed : 0);

		const analysis: ChunkAnalysis = {
			index,
			command,
			commandName: EDemoCommands[command] || 'unknown',
			size: chunk.size,
			isCompressed,
			rawCommand,
			analysisType: 'unknown',
			success: false,
			parseTimeMs: 0 // Will be set at the end
		};

		const data = chunk.data;
		if (!data) {
			analysis.error = 'No data available';
			return analysis;
		}

		// Add raw data sample
		const toHex = (bytes: Uint8Array) =>
			Array.from(bytes)
				.map((b) => b.toString(16).padStart(2, '0'))
				.join(' ');

		analysis.rawDataSample = {
			first20Bytes: toHex(data.slice(0, 20)),
			last10Bytes: toHex(data.slice(-10))
		};

		// Determine analysis type based on chunk command
		const networkPacketChunks = [
			EDemoCommands.DEM_Packet,
			EDemoCommands.DEM_SignonPacket,
			EDemoCommands.DEM_FullPacket,
			EDemoCommands.DEM_SpawnGroups
		];

		if (networkPacketChunks.includes(chunk.command)) {
			analysis.analysisType = 'network_packets';
			try {
				analysis.networkPackets = this.analyzeNetworkPackets(data, index, chunk.command);
				analysis.success = analysis.networkPackets.length > 0;
			} catch (error) {
				analysis.error = error instanceof Error ? error.message : String(error);
			}
		} else {
			analysis.analysisType = 'protobuf';
			const protobufResult = this.analyzeProtobuf(chunk.command, data);
			analysis.success = protobufResult.success;
			analysis.protobufData = protobufResult.data;
			analysis.error = protobufResult.error;
		}

		// Set chunk parse time
		analysis.parseTimeMs = performance.now() - chunkStartTime;

		return analysis;
	}

	analyzeFragment(buffer: ArrayBuffer): DemoAnalysis {
		const startTime = performance.now();

		const fragment = BroadcastFragment.from(buffer);
		const chunks = Array.from(fragment.chunks());

		const analysis: DemoAnalysis = {
			fragmentSize: fragment.size,
			totalChunks: chunks.length,
			totalParseTimeMs: 0, // Will be set at the end
			chunks: [],
			summary: {
				networkPacketChunks: 0,
				protobufChunks: 0,
				unknownChunks: 0,
				totalNetworkPackets: 0,
				errors: 0,
				packetErrors: 0,
				packetDecodeErrors: 0
			},
			performance: {
				averageChunkParseTimeMs: 0,
				slowestChunk: { index: 0, timeMs: 0 },
				fastestChunk: { index: 0, timeMs: Infinity }
			}
		};

		chunks.forEach((chunk, index) => {
			const chunkAnalysis = this.analyzeChunk(chunk, index);
			analysis.chunks.push(chunkAnalysis);

			// Update summary
			if (chunkAnalysis.analysisType === 'network_packets') {
				analysis.summary.networkPacketChunks++;
				if (chunkAnalysis.networkPackets) {
					analysis.summary.totalNetworkPackets += chunkAnalysis.networkPackets.length;

					// Count packet-level errors
					chunkAnalysis.networkPackets.forEach((packet) => {
						// Count parse errors (packet reading/structure errors)
						if (!packet.success || packet.error) {
							analysis.summary.packetErrors++;
						}
						// Count decode errors (protobuf decoding failures)
						if (!packet.decodeSuccess && packet.decodeError) {
							analysis.summary.packetDecodeErrors++;
						}
					});
				}
			} else if (chunkAnalysis.analysisType === 'protobuf') {
				analysis.summary.protobufChunks++;
			} else {
				analysis.summary.unknownChunks++;
			}

			// Count chunk-level errors
			if (!chunkAnalysis.success) {
				analysis.summary.errors++;
			}
		});

		// Calculate performance metrics
		const endTime = performance.now();
		analysis.totalParseTimeMs = endTime - startTime;

		if (analysis.chunks.length > 0) {
			const chunkTimes = analysis.chunks.map((c) => c.parseTimeMs);
			analysis.performance.averageChunkParseTimeMs =
				chunkTimes.reduce((a, b) => a + b, 0) / chunkTimes.length;

			const slowestTime = Math.max(...chunkTimes);
			const fastestTime = Math.min(...chunkTimes);

			analysis.performance.slowestChunk = {
				index: analysis.chunks.findIndex((c) => c.parseTimeMs === slowestTime),
				timeMs: slowestTime
			};

			analysis.performance.fastestChunk = {
				index: analysis.chunks.findIndex((c) => c.parseTimeMs === fastestTime),
				timeMs: fastestTime
			};
		}

		return analysis;
	}
}

// Output Formatters
export class OutputFormatter {
	static toJSON(analysis: DemoAnalysis, pretty: boolean = true): string {
		return JSON.stringify(analysis, null, pretty ? 2 : 0);
	}

	static toConsole(analysis: DemoAnalysis): void {
		console.log('=== DEMO ANALYSIS REPORT ===');
		console.log(`Fragment Size: ${analysis.fragmentSize} bytes`);
		console.log(`Total Chunks: ${analysis.totalChunks}`);
		console.log(`Network Packet Chunks: ${analysis.summary.networkPacketChunks}`);
		console.log(`Protobuf Chunks: ${analysis.summary.protobufChunks}`);
		console.log(`Unknown Chunks: ${analysis.summary.unknownChunks}`);
		console.log(`Total Network Packets: ${analysis.summary.totalNetworkPackets}`);
		console.log(`Chunk Errors: ${analysis.summary.errors}`);
		console.log(`Packet Parse Errors: ${analysis.summary.packetErrors}`);
		console.log(`Packet Decode Errors: ${analysis.summary.packetDecodeErrors}`);
		console.log('\n=== DETAILED ANALYSIS ===');

		analysis.chunks.forEach((chunk) => {
			console.log(`\nChunk ${chunk.index}: ${chunk.commandName} (${chunk.command})`);
			console.log(
				`  Size: ${chunk.size} bytes | Compressed: ${chunk.isCompressed} | Type: ${chunk.analysisType}`
			);
			console.log(`  Success: ${chunk.success}${chunk.error ? ` | Error: ${chunk.error}` : ''}`);

			if (chunk.networkPackets && chunk.networkPackets.length > 0) {
				console.log(`  Network Packets (${chunk.networkPackets.length}):`);
				chunk.networkPackets.forEach((packet) => {
					console.log(
						`    ${packet.packetIndex}: ${packet.typeName} (${packet.type}) - ${
							packet.size
						} bytes${packet.error ? ` | Error: ${packet.error}` : ''}`
					);
				});
			}
		});
	}
}
