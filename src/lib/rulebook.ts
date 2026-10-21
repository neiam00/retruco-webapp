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
    title: 'Truco, retruco y vale partida',
    paragraphs: [
      'Una mano sin apuesta de truco vale 1 piedra. Truco vale 3, retruco 6, vale 9 vale 9 y vale partida puede decidir la partida completa. Se puede cantar en cualquiera de las vueltas mientras corresponda el turno y la voz.',
      'Las subidas pueden saltar niveles: a truco se puede responder directamente «Quiero y vale 9». Si se rechaza una subida, quien la propuso gana la apuesta inmediatamente anterior, no un nivel intermedio que nadie aceptó. Rechazar truco inicial entrega 1 piedra.',
      'El equipo que acepta queda con la voz para volver a subir, en esa vuelta o en otra. La voz se alterna después de cada subida aceptada. La mano la sigue decidiendo el resultado de las cartas y los empardes.',
      'Vale partida no evita los pagos anteriores: si flor o envido ya decidieron la partida, no se aplica. Solo decide el ganador del truco cuando esos pagos dejaron la partida abierta.',
    ],
  },
  {
    title: 'Flor por derecho y declaraciones',
    paragraphs: [
      'Hay flor con tres cartas del mismo palo, o dos del mismo palo y perico o perica. Cada flor válida aporta 3 piedras al final de la mano. Dos flores válidas del mismo equipo aportan 6. Si ambos equipos llegan al objetivo con flores no disputadas, tiene prioridad el equipo de mano.',
      'Con flor por derecho, debes elegir manualmente «Flor» al mostrar una carta, «Con mi flor…» al cantar o responder y «Presento flor» al mostrar la última carta. Para jugar las dos pegadas se dice «Flor flor». Omitir la declaración quema la flor ordinaria, aunque la hayas declarado correctamente antes. La interfaz permite esa omisión.',
      'Si ambos compañeros tienen flor y se juega por derecho, el primero debe decir «A ley» con su primera carta; reemplaza «Flor» para esa carta. El segundo dice «Flor» al mostrar la suya. Sin ese «A ley», conserva la flor quien primero la declara; la otra se quema.',
      'Sin flor por derecho, las flores permanecen válidas sin esas declaraciones. Las pérdidas por un concurso de flor y la renuncia al cantar envido ordinario sí se aplican.',
    ],
  },
  {
    title: 'Flor frente a envido',
    paragraphs: [
      'Cantar envido ordinario cancela la flor ordinaria de quien lo canta, no la de su compañero. Una flor ordinaria rival que siga válida bloquea ese envido con «A las flores no». Una flor quemada ya no lo bloquea. La receta tampoco lo bloquea.',
      '«A las flores no» cierra el envido ordinario por toda la mano, aunque después se queme la flor que lo bloqueó. Todavía puede iniciarse una flor envidada si se cumplen sus condiciones. En cambio, un envido ya aceptado impide iniciar otra apuesta de flor.',
      'Con flores rivales y alguna ya declarada, antes de tu primera carta puedes cantar «Flor tengo y la mía envida». Se apuesta con las mismas subidas y límites del envido. Para conservar tu flor se responde «Con flor, quiero…». Retirarse con «Con mi flor me achico» invalida las flores ordinarias de todo el equipo.',
      'Decir «Con mi flor, truco» o «Con mi flor, quiero» también cuenta como haber declarado esa flor para permitir una flor envidada posterior.',
      'Cada equipo compara su mejor flor válida: 20 más los valores de las tres cartas. Gana el envido apostado y conserva sus flores; las flores ordinarias del equipo perdedor quedan inválidas. Una receta nunca pierde sus 3 piedras de flor. Empates se resuelven por el orden desde mano.',
      'Si se rechaza el concurso inicial, el equipo que lo cantó cobra 1 de envido, además de 3 por cada flor válida. Si una flor apostada se quema más tarde, se usa la mejor flor válida que quede en su equipo. Si solo queda flor en un equipo, ese equipo gana; si al finalizar no queda ninguna válida, no se paga el envido del concurso.',
    ],
  },
  {
    title: 'A ley, con ley y sin ley',
    paragraphs: [
      '«A ley» no confirma que tengas flor. «A ley, envido» permite apostar sin renunciar a la flor y evita el bloqueo de «A las flores no». El equipo que responde elige con ley o sin ley; esa elección se aplica por igual a ambos equipos.',
      'Con ley, una flor válida compara el valor de sus tres cartas más 20. Sin ley, se usa el envido ordinario de la mejor pareja. Ante un «A ley», el rival también puede cantar «Con ley, envido» o «Sin ley, envido».',
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
      'Hay emparde cuando varias cartas válidas comparten el valor más alto, incluso si son del mismo equipo. Empates por debajo de una carta ganadora única no cuentan. Una vuelta sin cartas válidas porque todas se quemaron también es emparde.',
      'Si un equipo gana la primera vuelta y la segunda emparda, gana la mano sin tercera vuelta. Si cada equipo gana una de las dos primeras y la tercera emparda, gana quien ganó la primera.',
      'Solo un emparde en la primera obliga a todos a jugar las dos restantes pegadas; abre mano. La de arriba representa la tercera vuelta y la de abajo la segunda. Primero se comparan las de arriba. Solo si empardan se revelan las de abajo. Si también empardan, gana el equipo de mano.',
      'Puedes jugar pegado voluntariamente en la segunda vuelta sin obligar a los demás. Abajo va la carta para la segunda y arriba la de la tercera. La de abajo queda oculta hasta que los demás jueguen su tercera carta, y solo se revela si hace falta para resolver.',
      'Si el equipo que ganó la primera también gana la tercera con una carta única que no fue jugada pegada, la mano ya está decidida: las cartas de abajo siguen ocultas. Las penalizaciones del pegado se calculan igualmente.',
      'En pegado voluntario, tu propia carta de abajo debe ganar la segunda para que la de arriba siga válida. Si pierde, se quema la de arriba aunque tu compañero haya ganado. La excepción es que ambas cartas de tu equipo emparden arriba de las dos rivales: entonces tu tercera sigue válida, aunque la segunda sea emparde.',
      'Si solo una persona juega pegado y la segunda está pendiente, abre la tercera quien está a su derecha. Si lo hacen varias, abre la primera persona que aún tenga carta en el orden desde mano. Se omite a quienes ya jugaron las dos. El castigo de quemar la de arriba no se aplica al pegado obligatorio.',
      'En la segunda o tercera vuelta puedes elegir «Quemar carta» y seleccionar una carta para pasar tu turno. Se juega boca abajo, queda inválida y ya no puedes volver a usarla. En pegado obligatorio, «Quemar las dos» descarta ambas cartas restantes. Nunca se puede quemar voluntariamente en la primera vuelta.',
      'Quemar voluntariamente exige las mismas declaraciones de flor que jugar: «Flor», «Presento flor» para la última carta o «Flor flor» al quemar las dos en pegado obligatorio. La receta sigue protegida y el valor original de envido no cambia.',
    ],
  },
  {
    title: 'Tiempos, desconexiones y salida',
    paragraphs: [
      'Hay 30 segundos para jugar una carta, partir el mazo o responder un canto. La respuesta es un único plazo compartido por el equipo. Un canto suspende las cartas y, al terminar, el jugador recibe 30 segundos nuevos. Si envido interrumpe truco, al volver a truco su equipo también recibe 30 segundos nuevos.',
      'Si se acaba el tiempo en la primera vuelta, se juega una carta al azar boca arriba y válida. Nunca se quema la primera. En otras vueltas se quema una carta restante al azar y se consume esa jugada. En pegado obligatorio se queman las dos restantes.',
      'Si vence el plazo de respuesta, se aplica «No quiero»; en flor envidada se aplica «Con mi flor me achico». Un plazo de truco o envido ordinario no quema flores por omisión de un integrante. El de flor envidada invalida las flores ordinarias de ambos compañeros. La receta sigue protegida.',
      'Desconectarse no detiene el juego ni los tiempos. Al volver recibes el estado actual y las consecuencias que ya hayan ocurrido. Salir expresamente de una partida hace perder inmediatamente a todo tu equipo.',
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
