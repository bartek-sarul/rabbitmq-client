#!/bin/bash

# Remove existing container if it exists
if [ "$(docker ps -aq -f name=test-rabbit)" ]; then
    echo "Removing existing test-rabbit container..."
    docker rm -f test-rabbit
fi

echo "Starting RabbitMQ with Management Plugin on ports 5672 (AMQP) and 15672 (HTTP)..."
docker run -d --name test-rabbit -p 5672:5672 -p 15672:15672 rabbitmq:3-management

echo "Waiting for RabbitMQ to boot (10 seconds)..."
sleep 10

echo "Creating exchange 'test_exchange' (type: direct)..."
docker exec test-rabbit rabbitmqadmin declare exchange name=test_exchange type=direct

echo "Creating queue 'test_queue'..."
docker exec test-rabbit rabbitmqadmin declare queue name=test_queue durable=true

echo "Binding 'test_queue' to 'test_exchange' with routing key 'test_key'..."
docker exec test-rabbit rabbitmqadmin declare binding source=test_exchange destination=test_queue routing_key=test_key

echo ""
echo "✅ RabbitMQ is ready!"
echo "---------------------------------------------------------"
echo "Management UI: http://localhost:15672 (guest/guest)"
echo "AMQP Connection URL: amqp://localhost"
echo "Exchange: test_exchange"
echo "Queue: test_queue"
echo "Routing Key: test_key"
echo "---------------------------------------------------------"
echo "To stop the container later, run: docker rm -f test-rabbit"
