import {cloneContent, shiftParent} from '../messageHelper';

export default function SignalEventDefinition(activity, eventDefinition) {
  const {id, broker} = activity;
  const {type} = eventDefinition;

  const source = {
    id,
    type,
    execute,
  };

  return source;

  function execute(executeMessage) {
    let completed;

    const messageContent = cloneContent(executeMessage.content);
    const {executionId, parent} = messageContent;
    const parentExecutionId = parent && parent.executionId;

    const messagesQ = broker.assertQueue('messages', {autoDelete: false, durable: true});
    messagesQ.consume(onMessage, {noAck: true, consumerTag: `_message-${executionId}`});
    if (completed) return;

    broker.subscribeTmp('api', `activity.#.${executionId}`, onApiMessage, {noAck: true, consumerTag: `_api-${executionId}`});
    broker.subscribeOnce('api', `activity.signal.${parentExecutionId}`, onApiMessage, {consumerTag: `_parent-signal-${executionId}`});

    broker.publish('event', 'activity.wait', {...messageContent, executionId: parentExecutionId, parent: shiftParent(parent)});

    function onApiMessage(routingKey, message) {
      const messageType = message.properties.type;
      switch (messageType) {
        case 'signal': {
          completed = true;
          stop();
          return signal(routingKey, {message: message.content.message});
        }
        case 'discard': {
          completed = true;
          stop();
          return broker.publish('execution', 'execute.discard', {...messageContent});
        }
        case 'stop': {
          stop();
          break;
        }
      }
    }

    function signal(_, {message}) {
      completed = true;
      return broker.publish('execution', 'execute.completed', {...messageContent, output: message, state: 'signal'});
    }

    function stop() {
      broker.cancel(`_message-${executionId}`);
      broker.cancel(`_api-${executionId}`);
      broker.cancel(`_parent-signal-${executionId}`);
    }

    function onMessage(routingKey, {content}) {
      stop();
      signal(routingKey, {
        message: content,
      });
    }
  }
}
