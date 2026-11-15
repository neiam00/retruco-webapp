export const rulebook = [
  {
    title: 'La mesa y las piedras',
    paragraphs: [
      'Se juega con una baraja española de 40 cartas, sin ochos ni nueves. Pueden jugar dos personas o cuatro en parejas; los compañeros se sientan enfrentados. Gana el primer equipo que alcanza o supera las 12 o 24 piedras elegidas para la mesa.',
      'Cada mano tiene hasta tres vueltas. Se juega en sentido contrario a las agujas del reloj. Normalmente gana la mano el equipo que gana dos vueltas; los empardes tienen reglas especiales.',
    ],
  },
  {
    title: 'Repartir, partir y mirar la vira',
    paragraphs: [
      'El primer repartidor se elige al azar. Después de cada mano, reparte la persona a su derecha, haya ganado quien haya ganado. Quien está a su izquierda parte el mazo y tiene 30 segundos para elegir un corte entre 1 y 39; si no lo hace, el servidor elige uno al azar.',
      'Las cartas salen del fondo del mazo. En parejas, quien parte mira la primera carta y se la pasa a su compañero. El repartidor mira la siguiente y se la pasa al suyo. Cada carta vista ya cuenta entre las tres del compañero. En una mesa de dos se omite este paso.',
      'Se completa el reparto dando una carta por persona en cada pasada, comenzando a la izquierda del repartidor y siguiendo en sentido antihorario. Se salta a quienes ya tienen tres cartas. La siguiente carta del fondo es la vira, que se muestra junto al mazo a la derecha del repartidor.',
      'La persona a la derecha del repartidor es mano y abre la primera vuelta. El repartidor es pie. Después de una vuelta ganada, abre la siguiente la persona que jugó la carta ganadora.',
    ],
  },
  {
    title: 'Perico y perica',
    paragraphs: [
      'El perico es el 11 del palo de la vira; la perica es el 10. Si la vira es un 10, el 12 de ese palo se convierte en perica. Si es un 11, el 12 se convierte en perico. Son las dos cartas más fuertes de la mano.',
      'Para envido y flor, el perico vale 10 y la perica 9, incluso cuando los representa un 12. Además, pueden completar cualquier palo. Los otros 10, 11 y 12 valen cero; las demás cartas conservan su número.',
    ],
  },
  {
    title: 'La voz y las respuestas',
    paragraphs: [
      'La voz pertenece al equipo y no es lo mismo que el turno de jugar. Ambos equipos empiezan con voz. Para iniciar un canto o subirlo más tarde debe ser tu turno y tu equipo debe tener la voz correspondiente.',
      'Un canto pendiente detiene las cartas. Cualquiera de los dos integrantes del equipo rival puede responder: la primera respuesta vale para todo el equipo. No necesita ser su turno. Una subida entrega la respuesta al otro equipo.',
      'En truco, un equipo no puede subir el último valor que él mismo cantó, ni siquiera mediante su compañero o en una vuelta posterior. Solo el equipo rival puede hacer la siguiente subida. Esta restricción no se traslada a los cantos de envido o flor.',
      'Aceptar truco conserva para el equipo que acepta el derecho exclusivo a la próxima subida. Aceptar envido cierra toda la apuesta de envido y flor envidada por esa mano, pero no impide que el otro equipo inicie truco.',
    ],
  },
  {
    title: 'Envido: apuesta y comparación',
    paragraphs: [
      'Puedes cantar envido solamente durante la primera vuelta y antes de jugar tu primera carta. No necesitas tener dos cartas del mismo palo: también puedes mentir. Mientras respondes a un truco pendiente puedes interrumpir con envido si aún cumples esa condición. Después del envido se vuelve al mismo truco y al mismo equipo que debía responder.',
      'El envido inicial vale 2 piedras si se acepta y 1 si se rechaza. «Quiero y envido» agrega 2. «Quiero y N piedras más» agrega N a la apuesta actual. Por ejemplo, de 2 a 4 y luego 5 más se llega a 9. Si se rechaza esa última subida, quien la propuso gana las 4 anteriores.',
      'La apuesta total no puede superar el objetivo de la mesa: 12 o 24. Una subida que exceda el límite no es válida y no se recorta automáticamente.',
      '«Envido la falta» vale lo que le falta al equipo que va adelante para llegar al objetivo. Se fija al cantarla, antes de sumar las flores de esa mano, y debe ser igual o mayor a la apuesta actual. Es terminal: solo se puede aceptar o rechazar.',
      'Aceptar o rechazar cierra el envido por el resto de la mano. Se compara y se paga al terminar la mano, incluso si el truco acaba con un «No quiero». No se muestran ni se pagan los tantos al aceptar.',
      'Con dos cartas compatibles, cuenta 20 más la mejor pareja. Una flor de 7, 6 y 5 tiene 33 de envido ordinario, no 38. Sin pareja, cuenta la carta de mayor valor. Gana el mejor envido del equipo; si rivales empatan, gana quien aparece antes en el orden original desde mano.',
    ],
  },
  {
    title: 'Privando: a una piedra de ganar',
    paragraphs: [
      'Al repartir una nueva mano, un equipo con 11 de 12 o 23 de 24 está privando. El servidor anuncia solamente el mayor envido de ese equipo, sin mentiras ni revelar sus cartas o los tantos individuales.',
      'Se abre un envido de 2 piedras. Al responder «Privo y Truco», el rival acepta el envido y el truco queda cantado por 3 piedras. Ambas apuestas son fijas. Con «No jugar», el rival concede 1 piedra y la partida. Agotar el tiempo de respuesta equivale a «No jugar».',
      'Si el equipo que priva tiene flor, gana inmediatamente. Si solo el rival tiene flor, su dueño puede «Presentar flor»: gana exactamente 3 piedras y termina la mano, sin envido ni truco. También puede jugar y conservar la flor, cumpliendo las declaraciones habituales.',
      'Si ambos equipos privan, anuncian su mayor envido y se juegan automáticamente el envido de 2 piedras y el truco de 3, sin subidas. Los empates usan el orden original desde mano. La flor tiene prioridad inmediata. Si ambos tienen flor, gana el equipo de mano.',
      'Cuando se juega la mano, se paga primero el envido, luego las flores válidas y finalmente el truco. Si el envido decide la partida, ya no se suman los puntos posteriores.',
    ],
  },
  {
    title: 'Truco, retruco y vale partida',
    paragraphs: [
      'Una mano sin apuesta de truco vale 1 piedra. Truco vale 3, retruco 6, vale 9 vale 9 y vale partida puede decidir la partida completa. Se puede cantar en cualquiera de las vueltas mientras corresponda el turno y la voz.',
      'Las subidas pueden saltar niveles: a truco se puede responder directamente «Quiero y vale 9». Si se rechaza una subida, quien la propuso gana la apuesta inmediatamente anterior, no un nivel intermedio que nadie aceptó. Rechazar truco inicial entrega 1 piedra.',
      'El equipo que acepta queda con la voz para volver a subir, en esa vuelta o en otra. Por ejemplo, si Nosotros cantamos truco, solo Ellos pueden subir a retruco. Si Ellos cantan retruco, solo Nosotros podemos subir a vale 9 o vale partida. La mano la sigue decidiendo el resultado de las cartas y los empardes.',
      'Vale partida no evita los pagos anteriores: si flor o envido ya decidieron la partida, no se aplica. Solo decide el ganador del truco cuando esos pagos dejaron la partida abierta.',
    ],
  },
  {
    title: 'Flor por derecho y declaraciones',
    paragraphs: [
      'La flor se forma con tres cartas del mismo palo, o dos del mismo palo y perico o perica. Cada flor sin disputar vale 3 piedras. Dos flores válidas de compañeros suman 6 si no se disputan. Si ambos equipos alcanzan el objetivo con flores sin disputar, tiene prioridad el equipo de mano.',
      'Con flor por derecho, di «Flor» al jugar una carta, «Presento flor» en la última y «Flor flor» al jugar las dos pegadas. Para cantar o responder truco se usa «Con mi flor…». Cuando dos flores entran en el envido, siguen válidas sin repetir la declaración.',
      'Si ambos compañeros tienen flor y se juega por derecho, el primero debe decir «A ley» con su primera carta; reemplaza «Flor» para esa carta. El segundo dice «Flor» al mostrar la suya. Sin ese «A ley», conserva la flor quien primero la declara; la otra se quema.',
      'Sin flor por derecho, las flores conservan su valor aunque el jugador omita la declaración. Una flor ordinaria puede achicarse al rechazar el envido con ley o quemarse al perder la comparación de flores.',
    ],
  },
  {
    title: 'Flor frente a envido',
    paragraphs: [
      'Con flor puedes abrir «A ley, envido». También puedes decir «Flor tengo y la mía envida» solo si otro jugador ya anunció flor. Si alguien dijo «A ley» y nadie ha anunciado flor, quien tiene flor debe abrir «Con ley, envido». Cada apertura requiere una respuesta.',
      'Con flor o después de que alguien la anunció, el envido ordinario queda fuera de juego. Si un rival abrió envido ordinario antes del anuncio, quien tenga flor puede decir «A las flores no» para anularlo.',
      '«A las flores no» cierra el envido ordinario durante toda la mano. La apuesta de ley conserva su ventana hasta la primera carta de quien la abre. Aceptar el envido cierra la negociación.',
      'Frente a «A ley, envido», quien tiene flor responde «Con ley, quiero» o «Con ley, no quiero». Si otro jugador ya anunció flor, «Flor tengo y la mía envida» también acepta. Sin flor, responde «Sin ley, quiero» o «Sin ley, no quiero». Ante «Con ley, envido» o «Flor tengo y la mía envida», un jugador sin flor solo puede decir «Sin ley, no quiero».',
      '«Sin ley, quiero» enfrenta el envido ordinario del jugador sin flor al valor completo de la flor rival. Un 7 y un 6 de copas con un 5 de oros suman 33 y pierden ante una flor de 36.',
      'Con ley se compara la mejor flor válida de cada equipo. Gana 3 piedras por la flor más alta más las piedras del envido aceptado, aunque el equipo tenga dos flores. Las flores ordinarias inferiores se queman. Si hay empate, gana quien está antes desde mano. La receta conserva su protección.',
      'Al rechazar la apertura con «Sin ley, no quiero», la flor válida del que cantó vale 3 y el envido vale 0. Con «Con ley, no quiero», se achica la flor del que responde y el que cantó cobra 3 por su flor válida y 1 por el envido rechazado.',
    ],
  },
  {
    title: 'A ley, con ley y sin ley',
    paragraphs: [
      'Puedes decir «A ley» con tu primera carta o abrir «A ley, envido» con cualquier mano. La frase no revela si tienes flor.',
      'Con la primera respuesta se fija la comparación. Las subidas y la falta siguen las reglas del envido. Si se rechaza una subida, se cobra la apuesta anterior.',
      'En parejas, cada jugador responde según su propia flor. Que el compañero tenga flor no autoriza a decir «Con ley».',
      'La apuesta de ley tiene una prioridad especial: se paga primero el envido, después la flor y después el truco. Si ese envido alcanza el objetivo, termina la partida antes de sumar flores.',
    ],
  },
  {
    title: 'La receta',
    paragraphs: [
      'Tener perico y perica juntos, con cualquier tercera carta, es receta. No se declara y nunca se quema. Siempre conserva 3 piedras de flor, incluso al perder o rechazar una flor envidada.',
      'Sin apuesta de envido da 1 piedra automática de envido. Una apuesta de envido aceptada reemplaza esa piedra, se gane o se pierda; rechazar envido también hace perder la piedra automática. No se suma como un premio extra a lo apostado.',
      'La receta no garantiza truco. El equipo que gana la mano recibe los puntos normales de truco. Las conocidas 5 piedras son 3 de flor, 1 de envido y 1 de truco cuando su equipo gana sin apuestas; no son un mínimo garantizado al perder.',
    ],
  },
  {
    title: 'Empardes y jugar pegado',
    paragraphs: [
      'En la primera vuelta hay emparde si comparten la carta más alta jugadores de equipos contrarios. Si las más altas son de dos compañeros, su equipo gana y abre la segunda quien jugó antes. En la segunda y tercera vuelta, dos cartas máximas iguales siguen empardando aunque sean del mismo equipo. Las cartas empatadas por debajo de la ganadora no empardan.',
      'Si un equipo gana la primera vuelta y la segunda emparda, gana la mano sin tercera vuelta. Si cada equipo gana una de las dos primeras y la tercera emparda, gana quien ganó la primera.',
      'Solo un emparde en la primera obliga a todos a jugar las dos restantes pegadas; abre mano. La de arriba representa la tercera vuelta y la de abajo la segunda. Primero se comparan las de arriba. Solo si empardan se revelan las de abajo. Si también empardan, gana el equipo de mano.',
      'Puedes jugar pegado voluntariamente en la segunda vuelta sin obligar a los demás. Abajo va la carta para la segunda y arriba la de la tercera. La de abajo queda oculta hasta que los demás jueguen su tercera carta, y solo se revela si hace falta para resolver.',
      'Si el equipo que ganó la primera también gana la tercera con una carta única que no fue jugada pegada, la mano ya está decidida: las cartas de abajo siguen ocultas. Las penalizaciones del pegado se calculan igualmente.',
      'En pegado voluntario, tu propia carta de abajo debe ganar la segunda para que la de arriba siga válida. Si pierde, se quema la de arriba aunque tu compañero haya ganado. La excepción es que ambas cartas de tu equipo emparden arriba de las dos rivales: entonces tu tercera sigue válida, aunque la segunda sea emparde.',
      'Si solo una persona juega pegado y la segunda está pendiente, abre la tercera quien está a su derecha. Si lo hacen varias, abre la primera persona que aún tenga carta en el orden desde mano. Se omite a quienes ya jugaron las dos. El castigo de quemar la de arriba no se aplica al pegado obligatorio.',
      'En la segunda o tercera vuelta puedes elegir «Quemar carta» y seleccionar una carta para pasar tu turno. Se juega boca abajo, queda inválida y ya no puedes volver a usarla. En pegado obligatorio, «Quemar las dos» descarta ambas cartas restantes. Nunca se puede quemar voluntariamente en la primera vuelta.',
      'Al quemar una carta se usa la declaración correspondiente a esa carta. Al quemar las dos en pegado obligatorio se usa «Flor flor». La receta conserva su protección.',
    ],
  },
  {
    title: 'Tiempos, desconexiones y salida',
    paragraphs: [
      'Hay 30 segundos para jugar una carta, partir el mazo o responder un canto. La respuesta es un único plazo compartido por el equipo. Un canto suspende las cartas y, al terminar, el jugador recibe 30 segundos nuevos. Si envido interrumpe truco, al volver a truco su equipo también recibe 30 segundos nuevos.',
      'Si se acaba el tiempo en la primera vuelta, se juega una carta al azar boca arriba y válida. Nunca se quema la primera. En otras vueltas se quema una carta restante al azar y se consume esa jugada. En pegado obligatorio se queman las dos restantes.',
      'Al vencer el plazo de respuesta se rechaza el canto automáticamente. El reloj no declara flor en nombre de ningún jugador. Un plazo de truco o envido ordinario conserva las flores por omisión. En una flor envidada, el rechazo automático del equipo puede invalidar sus flores ordinarias.',
      'Si queda otro jugador humano conectado, la partida y sus tiempos continúan. Cuando todos los jugadores humanos se desconectan, el juego se pausa y la mesa se conserva durante 2 minutos. Al volver un jugador, la partida se reanuda con un plazo nuevo para jugar o responder. Salir expresamente de una partida hace perder inmediatamente a todo tu equipo.',
      'Una mesa que todavía espera jugadores se elimina inmediatamente cuando sale expresamente su último jugador humano. Cerrar la página o perder conexión deja un plazo de 2 minutos para volver. Otra pestaña de un jugador humano conserva la mesa; los espectadores y las CPU no la mantienen abierta.',
    ],
  },
  {
    title: 'Señas, espectadores y orden de pago',
    paragraphs: [
      'Guiño derecho: perico. Guiño izquierdo: perica. Lengua a la derecha: 7 de espadas. Lengua a la izquierda: 7 de oros. Ambos ojos: receta. Puedes mentir con cualquier seña. Tu compañero siempre la ve; cada rival tiene una probabilidad independiente del 10% de verla, decidida de nuevo para cada seña.',
      'Los espectadores pueden cambiar de perspectiva en cualquier momento. Ven la mano de esa persona, la mesa pública y exactamente las señas que ella pudo ver. No reciben las otras manos ni una nueva oportunidad de descubrir una seña.',
      'Al terminar una mano se paga flor, envido y truco, en ese orden. Al alcanzar el objetivo se detienen los pagos siguientes. La excepción acordada para envido de ley es envido, flor y truco. Un vale partida solo decide la partida si los pagos anteriores no la decidieron.',
    ],
  },
];
