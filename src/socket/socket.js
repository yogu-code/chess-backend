import { Server } from "socket.io";
import { Chess } from "chess.js";

export let io;
export const userSocketMap = new Map();
const games = new Map();
const chessGames = new Map();

export const initSocketServer = async (server) => {
  io = new Server(server, {
    cors: {
      origin: [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "https://yogu-code.github.io"
      ],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    const { userId } = socket.handshake.query || socket.handshake.auth;
    socket.data.userId = userId;

    if (userId) {
      userSocketMap.set(userId, socket.id);
      console.log(`🔌 User ${userId} connected (Socket ID: ${socket.id})`);
    }

    socket.on("tictactoe-join", ({ roomId, userName }) => {
      const userId = socket.data.userId;
      if (!roomId || !userName || !userId) {
        socket.emit("tictactoe-error", { message: "Invalid join data" });
        return;
      }

      console.log(`🎮 ${userName} (${userId}) joining room: ${roomId}`);
      socket.join(roomId);

      if (!games.has(roomId)) {
        games.set(roomId, {
          board: Array(9).fill(null),
          currentPlayer: "X",
          players: [],
          playerNames: {},
          gameStarted: false,
          gameOver: false,
        });
      }

      const game = games.get(roomId);

      if (!game.players.includes(userId)) {
        if (game.players.length < 2) {
          game.players.push(userId);
          game.playerNames[userId] = userName;

          if (game.players.length === 2) {
            game.gameStarted = true;
            io.to(roomId).emit("tictactoe-joined", {
              roomId,
              players: game.players.length,
              gameStarted: true,
            });
          } else {
            socket.emit("tictactoe-waiting", {
              roomId,
              players: game.players.length,
            });
          }
        } else {
          socket.emit("tictactoe-error", { message: "Room is full" });
          return;
        }
      }

      io.to(roomId).emit("tictactoe-state", {
        board: game.board,
        currentPlayer: game.currentPlayer,
        players: game.players,
        playerNames: game.playerNames,
        gameStarted: game.gameStarted,
        gameOver: game.gameOver,
        winner: null,
      });
    });

    socket.on("tictactoe-move", ({ roomId, index }) => {
      const userId = socket.data.userId;
      if (!roomId || index === undefined) {
        socket.emit("tictactoe-error", { message: "Invalid move data" });
        return;
      }

      const game = games.get(roomId);
      if (!game || !game.gameStarted || game.gameOver) {
        socket.emit("tictactoe-error", {
          message: !game
            ? "Game not found"
            : !game.gameStarted
            ? "Game hasn't started"
            : "Game is over",
        });
        return;
      }

      if (game.board[index] !== null) {
        socket.emit("tictactoe-error", { message: "Cell already occupied" });
        return;
      }

      const playerIndex = game.players.indexOf(userId);
      if (playerIndex === -1) {
        socket.emit("tictactoe-error", {
          message: "You're not a player in this game",
        });
        return;
      }

      const expectedPlayer = playerIndex === 0 ? "X" : "O";
      if (game.currentPlayer !== expectedPlayer) {
        socket.emit("tictactoe-error", { message: "Not your turn" });
        return;
      }

      game.board[index] = game.currentPlayer;

      const winner = checkWinner(game.board);
      const isDraw = !winner && game.board.every((cell) => cell !== null);
      game.gameOver = !!winner || isDraw;

      if (!game.gameOver) {
        game.currentPlayer = game.currentPlayer === "X" ? "O" : "X";
      }

      io.to(roomId).emit("tictactoe-state", {
        board: game.board,
        currentPlayer: game.currentPlayer,
        players: game.players,
        playerNames: game.playerNames,
        gameStarted: game.gameStarted,
        gameOver: game.gameOver,
        winner: winner || (isDraw ? "draw" : null),
      });
    });

    socket.on("tictactoe-reset", ({ roomId }) => {
      const game = games.get(roomId);
      if (!game) return;

      game.board = Array(9).fill(null);
      game.currentPlayer = "X";
      game.gameOver = false;

      io.to(roomId).emit("tictactoe-state", {
        board: game.board,
        currentPlayer: game.currentPlayer,
        players: game.players,
        playerNames: game.playerNames,
        gameStarted: game.gameStarted,
        gameOver: game.gameOver,
        winner: null,
      });
    });

    socket.on("chess-create-room", ({ userName }) => {
      const userId = socket.data.userId;
      if (!userName || !userId) {
        socket.emit("chess-error", { message: "Invalid user data" });
        return;
      }

      const roomId = generateRoomId();
      console.log(`🏰 ${userName} (${userId}) creating chess room: ${roomId}`);

      const game = createChessGame();
      game.players.push(userId);
      game.playerNames[userId] = userName;
      game.playerColors[userId] = "white";

      chessGames.set(roomId, game);
      socket.join(roomId);

      socket.emit("chess-room-created", {
        roomId,
        playerColor: "white",
        playerName: userName,
        message: "Chess room created successfully!",
      });

      socket.emit("chess-state", {
        roomId,
        fen: game.chess.fen(),
        currentPlayer: game.currentPlayer,
        players: game.players,
        playerNames: game.playerNames,
        playerColors: game.playerColors,
        gameStarted: game.gameStarted,
        gameOver: game.gameOver,
        winner: game.winner,
        check: game.chess.inCheck(),
        checkmate: game.chess.isCheckmate(),
        stalemate: game.chess.isStalemate(),
        waitingForPlayer: true,
      });
    });

    socket.on("chess-join-room", ({ roomId, userName }) => {
      const userId = socket.data.userId;
      console.log(`♟️ ${userName} (${userId}) joining chess room: ${roomId}`);

      if (!roomId || !userName || !userId) {
        socket.emit("chess-error", { message: "Invalid join data" });
        return;
      }

      if (!chessGames.has(roomId)) {
        socket.emit("chess-error", { message: "Room not found" });
        return;
      }

      const game = chessGames.get(roomId);
      socket.join(roomId);

      // Check if player is reconnecting
      if (game.players.includes(userId)) {
        console.log(`🔄 Player ${userId} is reconnecting to room ${roomId}`);
        // Player is reconnecting - send current state
        io.to(roomId).emit("chess-state", {
          roomId,
          fen: game.chess.fen(),
          currentPlayer: game.currentPlayer,
          players: game.players,
          playerNames: game.playerNames,
          playerColors: game.playerColors,
          gameStarted: game.gameStarted,
          gameOver: game.gameOver,
          winner: game.winner,
          check: game.chess.inCheck(),
          checkmate: game.chess.isCheckmate(),
          stalemate: game.chess.isStalemate(),
          waitingForPlayer: game.players.length < 2,
        });
        return;
      }

      if (game.players.length >= 2) {
        socket.emit("chess-error", { message: "Room is full" });
        return;
      }

      // Add new player
      game.players.push(userId);
      game.playerNames[userId] = userName;
      game.playerColors[userId] = "black"; // Second player gets black
      game.gameStarted = true;

      console.log(`✅ Game state after join:`, {
        players: game.players,
        playerNames: game.playerNames,
        playerColors: game.playerColors,
        currentPlayer: game.currentPlayer,
      });

      // Notify all players that game started
      io.to(roomId).emit("chess-game-started", {
        roomId,
        players: game.players,
        playerNames: game.playerNames,
        playerColors: game.playerColors,
        message: "Game started! White plays first.",
      });

      // Send updated game state
      io.to(roomId).emit("chess-state", {
        roomId,
        fen: game.chess.fen(),
        currentPlayer: game.currentPlayer,
        players: game.players,
        playerNames: game.playerNames,
        playerColors: game.playerColors,
        gameStarted: game.gameStarted,
        gameOver: game.gameOver,
        winner: game.winner,
        check: game.chess.inCheck(),
        checkmate: game.chess.isCheckmate(),
        stalemate: game.chess.isStalemate(),
        waitingForPlayer: false,
      });
    });

    socket.on("chess-move", ({ roomId, from, to, piece, promotion }) => {
      const userId = socket.data.userId;
      console.log(`\n🎯 === MOVE ATTEMPT ===`);
      console.log(`Player: ${userId}`);
      console.log(`Room: ${roomId}`);
      console.log(`Move: ${from} → ${to}`);
      console.log(`Piece: ${piece}`);
      console.log(`Promotion: ${promotion}`);

      if (!roomId || !from || !to) {
        console.log(`❌ Invalid move data`);
        socket.emit("chess-error", { message: "Invalid move data" });
        return;
      }

      const game = chessGames.get(roomId);
      if (!game) {
        console.log(`❌ Game not found: ${roomId}`);
        socket.emit("chess-error", { message: "Game not found" });
        return;
      }

      if (!game.gameStarted) {
        console.log(`❌ Game not started`);
        socket.emit("chess-error", { message: "Game hasn't started" });
        return;
      }

      if (game.gameOver) {
        console.log(`❌ Game is over`);
        socket.emit("chess-error", { message: "Game is over" });
        return;
      }

      const playerColor = game.playerColors[userId];
      console.log(`🎨 Player color mapping:`, {
        userId,
        playerColor,
        allPlayerColors: game.playerColors,
        currentPlayer: game.currentPlayer,
      });

      if (!playerColor) {
        console.log(`❌ Player not found in game`);
        socket.emit("chess-error", { message: "Player not found in game" });
        return;
      }

      if (playerColor !== game.currentPlayer) {
        console.log(`❌ Not player's turn:`, {
          playerColor,
          currentPlayer: game.currentPlayer,
        });
        socket.emit("chess-error", {
          message: `Not your turn. Current player: ${game.currentPlayer}, Your color: ${playerColor}`,
        });
        return;
      }

      console.log(`📋 Current game state before move:`);
      console.log(`FEN: ${game.chess.fen()}`);
      console.log(`Board:\n${game.chess.ascii()}`);

      const moveResult = validateAndExecuteMove(game, from, to, promotion);

      if (!moveResult.valid) {
        console.log(`❌ Move validation failed:`, moveResult.error);
        socket.emit("chess-error", { message: moveResult.error });
        return;
      }

      console.log(`✅ Move validated and executed successfully`);

      // Record the move
      game.moves.push({
        from,
        to,
        piece: moveResult.move.piece,
        player: playerColor,
        timestamp: Date.now(),
        san: moveResult.move.san,
      });

      // Switch turns
      const previousPlayer = game.currentPlayer;
      game.currentPlayer = game.currentPlayer === "white" ? "black" : "white";
      console.log(
        `🔄 Turn switched: ${previousPlayer} → ${game.currentPlayer}`
      );

      // Update game state
      game.check = moveResult.check;
      game.checkmate = moveResult.checkmate;
      game.stalemate = moveResult.stalemate;
      game.gameOver = moveResult.checkmate || moveResult.stalemate;

      if (moveResult.checkmate) {
        game.winner = playerColor;
        console.log(`🏆 Checkmate! Winner: ${playerColor}`);
      } else if (moveResult.stalemate) {
        game.winner = "draw";
        console.log(`🤝 Stalemate! Game is a draw`);
      }

      console.log(`📋 Final game state after move:`);
      console.log(`FEN: ${game.chess.fen()}`);
      console.log(`Current player: ${game.currentPlayer}`);
      console.log(`Game over: ${game.gameOver}`);
      console.log(`Winner: ${game.winner}`);

      // Broadcast updated state to all players
      const gameStateUpdate = {
        roomId,
        fen: game.chess.fen(),
        currentPlayer: game.currentPlayer,
        players: game.players,
        playerNames: game.playerNames,
        playerColors: game.playerColors,
        gameStarted: game.gameStarted,
        gameOver: game.gameOver,
        winner: game.winner,
        check: game.chess.inCheck(),
        checkmate: game.chess.isCheckmate(),
        stalemate: game.chess.isStalemate(),
        lastMove: {
          from,
          to,
          piece: moveResult.move.piece,
          player: playerColor,
          san: moveResult.move.san,
        },
        waitingForPlayer: false,
      };

      console.log(`📤 Broadcasting game state update to room ${roomId}`);
      io.to(roomId).emit("chess-state", gameStateUpdate);

      // Confirm move to the player who made it
      socket.emit("chess-move-confirmed", {
        from,
        to,
        piece: moveResult.move.piece,
        fen: game.chess.fen(),
        success: true,
        san: moveResult.move.san,
      });

      console.log(`=== MOVE COMPLETE ===\n`);

      // Handle game end
      if (game.gameOver) {
        setTimeout(() => {
          io.to(roomId).emit("chess-game-ended", {
            roomId,
            message: "Game has ended. Returning to main menu.",
            winner: game.winner,
          });
          chessGames.delete(roomId);
          console.log(`🗑️ Deleted chess room ${roomId} due to game end`);
        }, 5000);
      }
    });

    socket.on("chess-reset", ({ roomId }) => {
      const game = chessGames.get(roomId);
      if (!game) return;

      game.chess = new Chess();
      game.currentPlayer = "white";
      game.gameOver = false;
      game.winner = null;
      game.moves = [];
      game.check = false;
      game.checkmate = false;
      game.stalemate = false;

      io.to(roomId).emit("chess-state", {
        roomId,
        fen: game.chess.fen(),
        currentPlayer: game.currentPlayer,
        players: game.players,
        playerNames: game.playerNames,
        playerColors: game.playerColors,
        gameStarted: game.gameStarted,
        gameOver: game.gameOver,
        winner: game.winner,
        check: game.chess.inCheck(),
        checkmate: game.chess.isCheckmate(),
        stalemate: game.chess.isStalemate(),
        waitingForPlayer: game.players.length < 2,
      });
    });

    socket.on("chess-chat-message", ({ roomId, userName, message }) => {
      if (!chessGames.has(roomId)) {
        socket.emit("chess-error", { message: "Room does not exist" });
        return;
      }
      if (!socket.rooms.has(roomId)) {
        socket.emit("chess-error", { message: "You are not in this room" });
        return;
      }
      const sanitizedMessage = sanitizeMessage(message);
      if (!sanitizedMessage) {
        socket.emit("chess-error", { message: "Invalid message" });
        return;
      }
      const timestamp = new Date().toISOString();
      io.to(roomId).emit("chess-chat-received", {
        userName,
        message: sanitizedMessage,
        timestamp,
      });
    });

    socket.on("disconnect", () => {
      const userId = socket.data.userId;
      if (userId) {
        userSocketMap.delete(userId);
        console.log(`❌ User ${userId} disconnected`);

        for (const [roomId, game] of games.entries()) {
          const playerIndex = game.players.indexOf(userId);
          if (playerIndex !== -1) {
            game.players.splice(playerIndex, 1);
            delete game.playerNames[userId];

            if (game.players.length === 0) {
              games.delete(roomId);
            } else {
              io.to(roomId).emit("player-disconnected", {
                disconnectedPlayer: userId,
                remainingPlayers: game.players.length,
              });

              io.to(roomId).emit("tictactoe-state", {
                board: game.board,
                currentPlayer: game.currentPlayer,
                players: game.players,
                playerNames: game.playerNames,
                gameStarted: false,
                gameOver: true,
                winner: null,
              });
            }
          }
        }

        for (const [roomId, game] of chessGames.entries()) {
          const playerIndex = game.players.indexOf(userId);
          if (playerIndex !== -1) {
            game.players.splice(playerIndex, 1);
            delete game.playerNames[userId];
            delete game.playerColors[userId];

            if (game.players.length === 0) {
              chessGames.delete(roomId);
              console.log(`🗑️ Deleted empty chess room: ${roomId}`);
            } else {
              io.to(roomId).emit("chess-player-disconnected", {
                disconnectedPlayer: userId,
                remainingPlayers: game.players.length,
                message: "Your opponent has disconnected",
              });

              game.gameStarted = false;
              io.to(roomId).emit("chess-state", {
                roomId,
                fen: game.chess.fen(),
                currentPlayer: game.currentPlayer,
                players: game.players,
                playerNames: game.playerNames,
                playerColors: game.playerColors,
                gameStarted: false,
                gameOver: false,
                winner: null,
                check: game.chess.inCheck(),
                checkmate: game.chess.isCheckmate(),
                stalemate: game.chess.isStalemate(),
                waitingForPlayer: true,
              });
            }
          }
        }
      }
    });
  });
};

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createChessGame() {
  return {
    chess: new Chess(),
    currentPlayer: "white",
    players: [],
    playerNames: {},
    playerColors: {},
    gameStarted: false,
    gameOver: false,
    winner: null,
    moves: [],
    check: false,
    checkmate: false,
    stalemate: false,
  };
}

function validateAndExecuteMove(game, from, to, promotion) {
  console.log(`🔍 Validating move:`, {
    from,
    to,
    promotion,
    currentFEN: game.chess.fen(),
    currentPlayer: game.currentPlayer,
    gameHistory: game.chess.history(),
  });

  try {
    // Get the piece at the 'from' square before making the move
    const pieceAtFrom = game.chess.get(from);
    console.log(`🎭 Piece at ${from}:`, pieceAtFrom);

    if (!pieceAtFrom) {
      console.log(`❌ No piece found at ${from}`);
      return {
        valid: false,
        error: `No piece found at ${from}`,
      };
    }

    // Check if it's the right player's turn
    const pieceColor = pieceAtFrom.color === "w" ? "white" : "black";
    if (pieceColor !== game.currentPlayer) {
      console.log(`❌ Wrong player's piece:`, {
        pieceColor,
        currentPlayer: game.currentPlayer,
      });
      return {
        valid: false,
        error: `It's ${game.currentPlayer}'s turn, but you're trying to move a ${pieceColor} piece`,
      };
    }

    // Get all possible moves for validation
    const possibleMoves = game.chess.moves({ square: from, verbose: true });
    console.log(
      `🎯 Possible moves from ${from}:`,
      possibleMoves.map((m) => m.to)
    );

    // Attempt the move
    const move = game.chess.move({
      from,
      to,
      promotion: promotion || undefined,
    });

    if (!move) {
      console.log(`❌ Chess.js rejected the move from ${from} to ${to}`);
      console.log(`📋 Current board state:`, game.chess.ascii());
      return {
        valid: false,
        error: `Invalid move from ${from} to ${to}. Possible moves: ${possibleMoves
          .map((m) => m.to)
          .join(", ")}`,
      };
    }

    console.log(`✅ Move executed successfully:`, move);
    console.log(`📋 New board state:`, game.chess.ascii());

    return {
      valid: true,
      check: game.chess.inCheck(),
      checkmate: game.chess.isCheckmate(),
      stalemate: game.chess.isStalemate(),
      error: null,
      move: move,
    };
  } catch (error) {
    console.error(`💥 Error in validateAndExecuteMove:`, error);
    console.log(`📋 Current board state:`, game.chess.ascii());
    return {
      valid: false,
      error: `Move validation error: ${error.message}`,
    };
  }
}

function checkWinner(board) {
  const winPatterns = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];

  for (const [a, b, c] of winPatterns) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return { valid: true, check: false, checkmate: false, stalemate: false };
}

function sanitizeMessage(message) {
  // Allow emojis and basic text, remove HTML tags
  if (!message) return "";
  // Remove HTML tags but preserve emojis (Unicode characters)
  const sanitized = message
    .replace(/<[^>]+>/g, "") // Remove HTML tags
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .slice(0, 200); // Limit to 200 characters
  return sanitized.trim();
}
