import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mediasoup from 'mediasoup';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

let worker;
let router;
let peers = {}; // Store peer-specific data
const transports = new Map(); // Store all transports by id
const producers = new Map(); // Store all producers by id
const consumers = new Map(); // Store all consumers by id

const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {},
  }
];

(async () => {
  worker = await mediasoup.createWorker();
  router = await worker.createRouter({ mediaCodecs });

  io.on('connection', async socket => {
    console.log(`Client connected: ${socket.id}`);
    peers[socket.id] = { socket };

    socket.emit('router-rtp-capabilities', router.rtpCapabilities);

    // Initialize peer data structure
    peers[socket.id] = {
      socket,
      sendTransportId: null,
      recvTransportId: null,
      producerIds: [], // IDs of producers created by this peer
      consumerIds: []  // IDs of consumers created by this peer
    };

    socket.on('create-transport', async ({ direction }, callback) => {
      console.log(`[Server] Peer ${socket.id} creating ${direction} transport`);
      const transport = await router.createWebRtcTransport({
        listenIps: [{ ip: '127.0.0.1', announcedIp: null }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      transports.set(transport.id, transport);
      console.log(`[Server] Transport ${transport.id} created for peer ${socket.id} (direction: ${direction})`);

      if (direction === 'send') {
        peers[socket.id].sendTransportId = transport.id;
      } else if (direction === 'recv') {
        peers[socket.id].recvTransportId = transport.id;
      } else {
        console.warn(`[Server] Unknown transport direction: ${direction} from peer ${socket.id}`);
        // Fallback, might be problematic if client doesn't send direction for some reason
        // or handle as an error depending on strictness.
      }

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });

      transport.on('dtlsstatechange', dtlsState => {
        console.log(`[Server] Transport ${transport.id} DTLS state: ${dtlsState}`);
        if (dtlsState === 'closed') {
          console.log(`[Server] Transport ${transport.id} DTLS closed, closing transport.`);
          // transport.close() will trigger 'close' event handled below
        }
      });

      transport.on('close', () => {
        console.log(`[Server] Transport ${transport.id} closed.`);
        transports.delete(transport.id);
        // Clean up associated producers/consumers if any were directly tied to this transport closing
        // (Producers/consumers also have their own 'transportclose' events)
        if (peers[socket.id]) {
            if (peers[socket.id].sendTransportId === transport.id) peers[socket.id].sendTransportId = null;
            if (peers[socket.id].recvTransportId === transport.id) peers[socket.id].recvTransportId = null;
        }
      });
    });

    socket.on('connect-transport', async ({ transportId, dtlsParameters }, callback) => {
      const transport = transports.get(transportId);
      if (!transport) {
        console.error(`[Server] connect-transport: Transport ${transportId} not found for peer ${socket.id}`);
        return callback({ error: `Transport ${transportId} not found` });
      }
      try {
        console.log(`[Server] Peer ${socket.id} connecting transport ${transportId}`);
        await transport.connect({ dtlsParameters });
        callback({}); // Success
      } catch (error) {
        console.error(`[Server] Error connecting transport ${transportId} for peer ${socket.id}:`, error);
        callback({ error: error.message });
      }
    });

    socket.on('produce', async ({ transportId, kind, rtpParameters, appData }, callback) => {
      const transport = transports.get(transportId);
      if (!transport) {
        console.error(`[Server] produce: Transport ${transportId} not found for peer ${socket.id}`);
        return callback({ error: `Transport ${transportId} not found to produce.` });
      }
      if (transport.id !== peers[socket.id]?.sendTransportId) {
        console.warn(`[Server] Peer ${socket.id} trying to produce on a non-send or non-owned transport ${transportId}.`);
        // return callback({ error: 'Cannot produce on this transport.' }); // Be stricter if needed
      }

      try {
        console.log(`[Server] Peer ${socket.id} producing ${kind} on transport ${transportId}`);
        console.log(`[Server] Peer ${socket.id} calling transport.produce with kind: ${kind}, transportId: ${transportId}`);
      const producer = await transport.produce({
        kind,
        rtpParameters,
        appData: { ...appData, peerId: socket.id } // Add peerId to appData
      });

      producers.set(producer.id, producer);
      peers[socket.id].producerIds.push(producer.id);
      // For this simplified version, we'll still use peers[socket.id].producer for the *last* producer for quick access in consume logic
      // This would need refinement for multiple producers from one peer.
      peers[socket.id].producer = producer; 

      console.log(`[Server] Producer ${producer.id} (kind: ${kind}, type: ${producer.type}, trackId: ${producer.rtpParameters.rtpStreamInfos?.[0]?.ssrc || 'N/A'}) created for peer ${socket.id} on transport ${transportId}. appData:`, producer.appData);
      callback({ id: producer.id });

      // Notify others with the new producer's ID
      console.log(`[Server] Broadcasting new-producer: ${producer.id}`);
      socket.broadcast.emit('new-producer', { newProducerId: producer.id });

      producer.on('transportclose', () => {
        console.log(`[Server] Producer ${producer.id} transport closed`);
        if (!producer.closed) producer.close(); // This will trigger 'close' event for producer
        // producers.delete(producer.id) will be handled in producer.on('close')

        // Notify all clients that this producer has closed
        io.emit('producer-closed', { producerId: producer.id });
      });

      producer.on('close', () => {
        console.log(`[Server] Producer ${producer.id} (event: 'close')`);
        producers.delete(producer.id);
        
        // Notify all clients that this producer has closed
        io.emit('producer-closed', { producerId: producer.id });
        
        if (peers[socket.id]) {
          peers[socket.id].producerIds = peers[socket.id].producerIds.filter(pid => pid !== producer.id);
          if (peers[socket.id].producer && peers[socket.id].producer.id === producer.id) {
             peers[socket.id].producer = null; // Clear if it was the 'last' producer reference
          }
        }
      });
    } catch (error) {
        console.error(`[Server] Error in 'produce' handler for peer ${socket.id}, transport ${transportId}:`, error);
        callback({ error: error.message });
    }
    });

    socket.on('consume', async ({ transportId, rtpCapabilities, producerId: requestedProducerId, preferredKind }, callback) => {
      const transport = transports.get(transportId);
      if (!transport) {
        console.error(`[Server] consume: Transport ${transportId} not found for peer ${socket.id}`);
        return callback({ error: `Transport ${transportId} not found to consume.` });
      }
      if (transport.id !== peers[socket.id]?.recvTransportId) {
        console.warn(`[Server] Peer ${socket.id} trying to consume on a non-recv or non-owned transport ${transportId}.`);
        // return callback({ error: 'Cannot consume on this transport.' }); // Be stricter if needed
      }
      let producerToConsume;
      console.log(`[Server] 'consume' request from peer ${socket.id} for producerId: '${requestedProducerId || 'any'}'. Checking ${producers.size} active producers.`);
      // Log all available producers and their kinds
      if (producers.size > 0) {
        console.log('[Server] Available producers:');
        producers.forEach(p => {
          console.log(`  - ID: ${p.id}, Kind: ${p.kind}, Closed: ${p.closed}, Consumable: ${router.canConsume({ producerId: p.id, rtpCapabilities })}, Peer: ${p.appData.peerId}`);
        });
      } else {
        console.log('[Server] No producers available.');
      }
      if (requestedProducerId) {
        producerToConsume = producers.get(requestedProducerId);
        if (producerToConsume && producerToConsume.closed) producerToConsume = null; // Treat closed producer as not found

        if (producerToConsume && peers[socket.id].producerIds.includes(producerToConsume.id)) {
            console.warn(`[Server] Peer ${socket.id} attempting to consume its own producer ${requestedProducerId}. Denying.`);
            return callback({ error: 'Cannot consume own producer.' });
        }
      } else {
        // Fallback: find active producers not from this peer
        // If preferredKind is specified (e.g., 'video'), prioritize that kind
        console.log(`[Server] No specific producerId requested. Looking for any producer${preferredKind ? ` with preferred kind: ${preferredKind}` : ''}`);
        
        // First try to find producers matching the preferred kind
        if (preferredKind) {
          for (const [id, p] of producers) {
            if (!p.closed && !peers[socket.id].producerIds.includes(id) && p.kind === preferredKind) {
              console.log(`[Server] Found matching producer with preferred kind ${preferredKind}: ${id}`);
              producerToConsume = p;
              break;
            }
          }
        }
        
        // If no preferred kind producer found, fall back to any producer
        if (!producerToConsume) {
          for (const [id, p] of producers) {
            if (!p.closed && !peers[socket.id].producerIds.includes(id)) {
              console.log(`[Server] Falling back to producer: ${id} (kind: ${p.kind})`);
              producerToConsume = p;
              break;
            }
          }
        }
      }


      if (producerToConsume) {
        console.log(`[Server] Selected producerToConsume: ID: ${producerToConsume.id}, Kind: ${producerToConsume.kind}, Closed: ${producerToConsume.closed}, from Peer: ${producerToConsume.appData.peerId}`);
      } else {
        console.log(`[Server] No suitable producerToConsume was found after filtering for peer ${socket.id} (requested: ${requestedProducerId || 'any'}).`);
      }

      if (!producerToConsume || !router.canConsume({ producerId: producerToConsume.id, rtpCapabilities })) {
        const msg = `[Server] Cannot consume. Producer ${requestedProducerId || 'any available'} not found, closed, or not consumable for peer ${socket.id}.`;
        console.error(msg);
        return callback({ error: msg });
      }

      console.log(`[Server] Peer ${socket.id} consuming producer ${producerToConsume.id}`);

      const consumer = await transport.consume({
        producerId: producerToConsume.id, // Use the determined producerToConsume
        rtpCapabilities,
        paused: true, // Best practice: start paused, client resumes
        appData: { ...(producerToConsume.appData || {}), consumingPeerId: socket.id, producerPeerId: producerToConsume.appData.peerId } // Add relevant peerIds
      });

      consumers.set(consumer.id, consumer);
      peers[socket.id].consumerIds.push(consumer.id);
      // For this simplified version, we'll still use peers[socket.id].consumer for the *last* consumer for quick access.
      // This would need refinement for multiple consumers from one peer.
      peers[socket.id].consumer = consumer; 

      consumer.on('transportclose', () => {
        console.log(`[Server] Consumer ${consumer.id} transport closed`);
        if (!consumer.closed) consumer.close();
        consumers = consumers.filter(c => c.id !== consumer.id);
      });
      consumer.on('producerclose', () => {
        console.log(`[Server] Consumer ${consumer.id} (for producer ${consumer.producerId}) had its producer close.`);
        if (!consumer.closed) consumer.close();
        consumers = consumers.filter(c => c.id !== consumer.id);
        // Optionally notify the client that this consumer's producer has specifically closed
        // peers[socket.id]?.socket.emit('consumer-producer-closed', { consumerId: consumer.id, producerId: consumer.producerId });
      });
       consumer.on('close', () => {
        console.log(`[Server] Consumer ${consumer.id} (event: 'close')`);
        consumers.delete(consumer.id);
        if (peers[socket.id]) {
          peers[socket.id].consumerIds = peers[socket.id].consumerIds.filter(cid => cid !== consumer.id);
          if (peers[socket.id].consumer && peers[socket.id].consumer.id === consumer.id) {
            peers[socket.id].consumer = null; // Clear if it was the 'last' consumer reference
          }
        }
      });

      callback({
        id: consumer.id,
        producerId: consumer.producerId, // Send back which producer was actually consumed
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    });

    socket.on('resume-consumer', async ({ consumerId }, callback) => {
      const consumer = consumers.get(consumerId);
      if (consumer && !consumer.closed) {
        try {
          await consumer.resume();
          console.log(`[Server] Consumer ${consumerId} resumed for peer ${socket.id}`);
          if (callback) callback({}); // Success
        } catch (e) {
          console.error(`[Server] Error resuming consumer ${consumerId} for peer ${socket.id}:`, e);
          if (callback) callback({ error: e.message });
        }
      } else {
        const msg = `[Server] Cannot resume consumer ${consumerId} for peer ${socket.id}: Not found or closed.`;
        console.error(msg);
        if (callback) callback({ error: msg });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Server] Client disconnecting: ${socket.id}`);
      const peerData = peers[socket.id];
      if (peerData) {
        // Close all producers associated with this peer
        peerData.producerIds.forEach(producerId => {
          const producer = producers.get(producerId);
          if (producer && !producer.closed) {
            console.log(`[Server] Disconnect: Closing producer ${producerId} for peer ${socket.id}`);
            producer.close(); // This will trigger 'close' event and removal from Map
          }
        });

        // Close all consumers associated with this peer
        peerData.consumerIds.forEach(consumerId => {
          const consumer = consumers.get(consumerId);
          if (consumer && !consumer.closed) {
            console.log(`[Server] Disconnect: Closing consumer ${consumerId} for peer ${socket.id}`);
            consumer.close(); // This will trigger 'close' event and removal from Map
          }
        });

        // Close send transport if it exists
        if (peerData.sendTransportId) {
          const sendTransport = transports.get(peerData.sendTransportId);
          if (sendTransport && !sendTransport.closed) {
            console.log(`[Server] Disconnect: Closing send transport ${peerData.sendTransportId} for peer ${socket.id}`);
            sendTransport.close(); // This will trigger 'close' event and removal from Map
          }
        }
        // Close recv transport if it exists
        if (peerData.recvTransportId) {
          const recvTransport = transports.get(peerData.recvTransportId);
          if (recvTransport && !recvTransport.closed) {
            console.log(`[Server] Disconnect: Closing recv transport ${peerData.recvTransportId} for peer ${socket.id}`);
            recvTransport.close(); // This will trigger 'close' event and removal from Map
          }
        }
        delete peers[socket.id];
      }
      console.log(`[Server] Client disconnected: ${socket.id}, remaining peers: ${Object.keys(peers).length}`);
    });
  });

  server.listen(3001, () => console.log('Mediasoup server running on http://localhost:3001'));
})();
